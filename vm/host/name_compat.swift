import Foundation

// Existing guest disks keep their account, fstab tag and private socket prefix.
func usesLegacyNameProfile(_ state: String) -> Bool {
    let directory = URL(fileURLWithPath:state)
    for filename in ["name-profile.json", "native-ready.json", "runtime.json"] {
        if let data = try? Data(contentsOf:directory.appendingPathComponent(filename)),
           let value = try? JSONSerialization.jsonObject(with:data) as? [String:Any] {
            if value["user"] as? String == "manta" || value["guestUser"] as? String == "manta" || value["schema"] as? String == "manta-nos3-native-ready-v1" { return true }
            if value["user"] as? String == "daidalis" || value["guestUser"] as? String == "daidalis" || value["schema"] as? String == "daidalis-nos3-native-ready-v1" { return false }
        }
    }
    if let seed = try? String(contentsOf:directory.appendingPathComponent("seed/user-data"), encoding:.utf8) {
        return seed.contains("name: manta")
    }
    return false
}


func vmRuntimeNamePrefix(_ state: String) -> String {
    return usesLegacyNameProfile(state) ? "manta-vm" : "daidalis-vm"
}

func vmTransferNameTag(_ state: String) -> String {
    return usesLegacyNameProfile(state) ? "manta-transfer" : "daidalis-transfer"
}
