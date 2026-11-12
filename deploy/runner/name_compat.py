"""Read-only lookup of persistent native homes created before the product rename."""
import subprocess


def native_home_volume(broker, digest):
    preferred = 'daidalis-native-' + digest
    legacy = 'manta-native-' + digest
    for candidate in (preferred, legacy):
        try:
            broker.docker('volume', 'inspect', candidate)
            return candidate
        except (subprocess.CalledProcessError, RuntimeError):
            pass
    return preferred
