import Foundation
import Virtualization
print("supported=\(VZVirtualMachine.isSupported)")
print("cpu=\(VZVirtualMachineConfiguration.minimumAllowedCPUCount)...\(VZVirtualMachineConfiguration.maximumAllowedCPUCount)")
print("ram=\(VZVirtualMachineConfiguration.minimumAllowedMemorySize)...\(VZVirtualMachineConfiguration.maximumAllowedMemorySize)")
