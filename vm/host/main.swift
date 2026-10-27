import Foundation
import Virtualization
import Darwin
import CryptoKit

func runtimeDirectory(_ state: String) -> String {
    // Foundation may collapse /private/var back to /var. POSIX realpath agrees
    // with the Python helper used by SSH, including macOS temporary directories.
    let resolved = realpath(state,nil)
    let canonical = resolved.map { String(cString:$0) } ?? URL(fileURLWithPath:state).standardizedFileURL.path
    if let resolved { free(resolved) }
    let digest = SHA256.hash(data:Data(canonical.utf8)).map { String(format:"%02x",$0) }.joined().prefix(16)
    return "/private/tmp/manta-vm-\(getuid())-\(digest)"
}

func prepareRuntimeDirectory(_ state: String) throws -> String {
    let directory = runtimeDirectory(state)
    if mkdir(directory,0o700) != 0 && errno != EEXIST { throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno)) }
    var info = stat()
    guard lstat(directory,&info) == 0,
          info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
          info.st_uid == getuid(), info.st_mode & 0o777 == 0o700 else {
        throw NSError(domain:"MantaVM",code:5,userInfo:[NSLocalizedDescriptionKey:"Manta VM communication directory must be a private directory owned by this user"])
    }
    return directory
}

struct Settings: Decodable {
    var kernel: String
    var initrd: String
    var disk: String
    var seed: String
    var state: String
    var shared: String
    var cpu: Int = 4
    var memoryMiB: UInt64 = 4096
    var minimumHostFreeGiB: UInt64 = 5
}

func fail(_ text: String) -> Never {
    FileHandle.standardError.write(Data((text + "\n").utf8))
    exit(1)
}

final class Machine: NSObject, VZVirtualMachineDelegate {
    let settings: Settings
    var vm: VZVirtualMachine!
    var signals: [DispatchSourceSignal] = []
    var guardTimer: DispatchSourceTimer?
    var listener: Int32 = -1
    var isStopping = false
    var activeConnections: [UUID: VZVirtioSocketConnection] = [:]
    var sshSocket: String { runtimeDirectory(settings.state) + "/ssh.sock" }
    init(_ settings: Settings) { self.settings = settings }

    func status(_ value: String, error: String? = nil) {
        var data: [String: Any] = ["state":value, "pid":getpid(), "updatedAt":ISO8601DateFormatter().string(from:Date()), "cpu":settings.cpu, "memoryMiB":settings.memoryMiB, "sshSocket":sshSocket, "guestBootState":value == "running" ? "booting" : value, "guestReady":false]
        if let error { data["error"] = error }
        if let json = try? JSONSerialization.data(withJSONObject:data, options:[.prettyPrinted,.sortedKeys]) {
            try? json.write(to:URL(fileURLWithPath:settings.state).appendingPathComponent("status.json"), options:.atomic)
            try? json.write(to:URL(fileURLWithPath:settings.state).appendingPathComponent("runtime.json"), options:.atomic)
        }
        print("MANTA_VM \(value)\(error.map { ": \($0)" } ?? "")")
        fflush(stdout)
    }

    func configure() throws {
        guard VZVirtualMachine.isSupported else { throw NSError(domain:"MantaVM",code:1,userInfo:[NSLocalizedDescriptionKey:"Apple Virtualization unavailable in this execution context"]) }
        guard settings.cpu >= 1 && settings.cpu <= 4 && settings.memoryMiB >= 512 && settings.memoryMiB <= 4096 && settings.minimumHostFreeGiB >= 5 else {
            throw NSError(domain:"MantaVM",code:3,userInfo:[NSLocalizedDescriptionKey:"VM resource configuration exceeds the isolated runner limits"])
        }
        let attrs = try FileManager.default.attributesOfFileSystem(forPath:settings.disk)
        guard let free = attrs[.systemFreeSize] as? NSNumber, free.uint64Value >= settings.minimumHostFreeGiB * 1024 * 1024 * 1024 else {
            throw NSError(domain:"MantaVM",code:4,userInfo:[NSLocalizedDescriptionKey:"Insufficient host free space; preserving the configured host reserve"])
        }
        let config = VZVirtualMachineConfiguration()
        let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath:settings.kernel))
        boot.initialRamdiskURL = URL(fileURLWithPath:settings.initrd)
        boot.commandLine = "console=hvc0 root=LABEL=cloudimg-rootfs rw rootwait ds=nocloud net.ifnames=0"
        config.bootLoader = boot
        config.platform = VZGenericPlatformConfiguration()
        config.cpuCount = settings.cpu
        config.memorySize = settings.memoryMiB * 1024 * 1024
        config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
        config.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]
        let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
        let log = URL(fileURLWithPath:settings.state).appendingPathComponent("console.log")
        if !FileManager.default.fileExists(atPath:log.path) { FileManager.default.createFile(atPath:log.path,contents:nil) }
        let output = try FileHandle(forWritingTo:log)
        try output.seekToEnd()
        serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading:nil, fileHandleForWriting:output)
        config.serialPorts = [serial]
        config.storageDevices = try [
            VZVirtioBlockDeviceConfiguration(attachment:VZDiskImageStorageDeviceAttachment(url:URL(fileURLWithPath:settings.disk), readOnly:false, cachingMode:.cached, synchronizationMode:.full)),
            VZVirtioBlockDeviceConfiguration(attachment:VZDiskImageStorageDeviceAttachment(url:URL(fileURLWithPath:settings.seed), readOnly:true))
        ]
        let network = VZVirtioNetworkDeviceConfiguration()
        network.attachment = VZNATNetworkDeviceAttachment()
        network.macAddress = VZMACAddress(string:"52:54:00:4d:41:4e")!
        config.networkDevices = [network]
        config.socketDevices = [VZVirtioSocketDeviceConfiguration()]
        let share = VZVirtioFileSystemDeviceConfiguration(tag:"manta-transfer")
        share.share = VZSingleDirectoryShare(directory:VZSharedDirectory(url:URL(fileURLWithPath:settings.shared),readOnly:false))
        config.directorySharingDevices = [share]
        try config.validate()
        vm = VZVirtualMachine(configuration:config)
        vm.delegate = self
    }

    func setupSSHRelay() throws {
        let path = try prepareRuntimeDirectory(settings.state) + "/ssh.sock"
        guard path.utf8.count < 104 else { throw NSError(domain:"MantaVM",code:2,userInfo:[NSLocalizedDescriptionKey:"SSH socket path too long"]) }
        var previous = stat()
        if lstat(path,&previous) == 0 {
            guard previous.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK), previous.st_uid == getuid() else {
                throw NSError(domain:"MantaVM",code:6,userInfo:[NSLocalizedDescriptionKey:"Refusing to replace a non-socket SSH relay path"])
            }
            unlink(path)
        } else if errno != ENOENT { throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno)) }
        listener = socket(AF_UNIX,SOCK_STREAM,0)
        guard listener >= 0 else { throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno)) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        withUnsafeMutableBytes(of:&address.sun_path) { target in target.copyBytes(from:bytes.map { UInt8(bitPattern:$0) }) }
        let bound = withUnsafePointer(to:&address) { pointer in pointer.withMemoryRebound(to:sockaddr.self,capacity:1) { Darwin.bind(listener,$0,socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard bound == 0, listen(listener,16) == 0 else { throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno)) }
        chmod(path,0o600)
        DispatchQueue.global().async { [self] in
            while !isStopping {
                let client = accept(listener,nil,nil)
                if client < 0 { if isStopping { return }; continue }
                DispatchQueue.main.async { [self] in
                    guard let device = vm.socketDevices.first as? VZVirtioSocketDevice else { close(client); return }
                    device.connect(toPort:2222) { [self] result in
                        switch result {
                        case .failure(let error):
                            FileHandle.standardError.write(Data("SSH relay: \(error)\n".utf8)); close(client)
                        case .success(let connection):
                            let token = UUID()
                            activeConnections[token] = connection
                            let remote = connection.fileDescriptor
                            DispatchQueue.global().async { [self] in
                                Self.relay(client,remote)
                                close(client)
                                DispatchQueue.main.async { [self] in activeConnections.removeValue(forKey:token)?.close() }
                            }
                        }
                    }
                }
            }
        }
    }

    static func relay(_ first: Int32, _ second: Int32) {
        var descriptors = [pollfd(fd:first,events:Int16(POLLIN),revents:0),pollfd(fd:second,events:Int16(POLLIN),revents:0)]
        var buffer = [UInt8](repeating:0,count:65536)
        while true {
            let ready = poll(&descriptors,2,1000)
            if ready < 0 { if errno == EINTR { continue }; return }
            if ready == 0 { continue }
            for index in 0...1 {
                if descriptors[index].revents & Int16(POLLIN) != 0 {
                    let count = read(descriptors[index].fd,&buffer,buffer.count)
                    if count <= 0 { return }
                    let destination = descriptors[1-index].fd
                    var offset = 0
                    while offset < count {
                        let sent = buffer.withUnsafeBytes { bytes in write(destination,bytes.baseAddress!.advanced(by:offset),count-offset) }
                        if sent <= 0 { return }
                        offset += sent
                    }
                }
                if descriptors[index].revents & Int16(POLLERR | POLLNVAL) != 0 { return }
                if descriptors[index].revents & Int16(POLLHUP) != 0 && descriptors[index].revents & Int16(POLLIN) == 0 { return }
            }
        }
    }

    func start() throws {
        try configure()
        try setupSSHRelay()
        signal(SIGPIPE,SIG_IGN)
        for sig in [SIGTERM,SIGINT] {
            signal(sig,SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal:sig,queue:.main)
            source.setEventHandler { [self] in stop("requested") }
            source.resume(); signals.append(source)
        }
        let timer = DispatchSource.makeTimerSource(queue:.main)
        timer.schedule(deadline:.now()+2,repeating:2)
        timer.setEventHandler { [self] in
            if let attrs = try? FileManager.default.attributesOfFileSystem(forPath:settings.disk), let free = attrs[.systemFreeSize] as? NSNumber, free.uint64Value < settings.minimumHostFreeGiB * 1024 * 1024 * 1024 {
                stop("host-free-space-reserve")
            }
        }
        timer.resume(); guardTimer = timer
        status("starting")
        vm.start { [self] result in
            switch result {
            case .success: status("running")
            case .failure(let error): status("failed",error:error.localizedDescription); exit(1)
            }
        }
    }

    func stop(_ reason: String) {
        guard !isStopping else { return }
        isStopping = true
        status("stopping",error:reason)
        if listener >= 0 { Darwin.shutdown(listener,SHUT_RDWR); close(listener) }
        do { try vm.requestStop() } catch { vm.stop { _ in exit(0) } }
        DispatchQueue.main.asyncAfter(deadline:.now()+20) { [self] in vm.stop { [self] _ in self.status("stopped"); exit(0) } }
    }
    func guestDidStop(_ virtualMachine: VZVirtualMachine) { status("stopped"); exit(0) }
    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) { status("failed",error:error.localizedDescription); exit(1) }
}

if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--socket-path" {
    print(runtimeDirectory(CommandLine.arguments[2]) + "/ssh.sock")
    exit(0)
}
guard CommandLine.arguments.count == 2 else { fail("Usage: manta-vm CONFIG.json") }
do {
    let settings = try JSONDecoder().decode(Settings.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
    let machine = Machine(settings)
    try machine.start()
    RunLoop.main.run()
} catch { fail("Manta VM: \(error)") }
