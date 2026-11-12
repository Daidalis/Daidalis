# Upgrade the application name to Daidalis

The product, package, launchers, internal service identifiers and new output formats
use **Daidalis**. The naming forms are `Daidalis` in the interface, `daidalis` in
paths and protocol identifiers, and `DAIDALIS_*` for application settings.

This upgrade changes names. Project IDs, conversations, requirements, engineering
plans, API settings, model source and numerical behavior keep their existing
meaning. Author attribution and third-party project names retain their original
meaning.

## Source installations

The default checkout-local `data/` directory is unchanged. Continue using an
explicit custom data directory when upgrading an existing installation.

The application reads previous `MANTA_*` and project-owned `MBSE_*` environment
settings at the compatibility boundary. Explicit `DAIDALIS_*` settings, including
empty overrides, take precedence. New documentation and generated configuration
use only the new prefix. Existing dedicated connector and worker credential
references remain readable; changing the application name does not require
changing the secret value or entering it into a migration command.

The configuration migration tool can preview the local file changes without
inspecting Docker:

```sh
python3 deploy/docker/migrate-name.py --skip-docker
python3 deploy/docker/migrate-name.py --skip-docker --apply
```

Use `--root /absolute/path/to/Daidalis` when running the tool from another
directory. It updates recognized application configuration; it does not replace
text in user models or conversations. If both old and new settings are present
with different values, resolve the reported conflict before applying migration.

## Existing Docker installations

The Compose application service is now `daidalis`, and the application directory
inside new images is `/opt/daidalis`. The persistent mount points `/data`,
`/projects` and `/home/node` remain the data boundaries.

Changing the default Compose project name can otherwise create new empty volumes.
Use the migration tool to explicitly reuse the existing volumes:

```sh
python3 deploy/docker/migrate-name.py --project manta
python3 deploy/docker/migrate-name.py --project manta --apply
```

Replace `manta` with the actual previous Compose project name. Preview is the
default. Applying migration backs up the recognized configuration files before
updating them and creates `deploy/local/name-migration.compose.yaml` to reference
the existing volumes by their external names. Existing custom Compose project
names are preserved. Repeating migration does not copy or merge project data.

The migration tool does not stop containers, start services or remove volumes.
Perform the service switch after active tasks have finished: use the previous
deployment configuration to stop the old services, back up their persistent
volumes, apply migration, and start the updated deployment using its saved Compose
configuration. Keep the old images and backups until the upgraded application has
been checked. A manually created `docker run` deployment should explicitly reuse
its existing named volumes when starting the updated image; it is not converted
into a Compose deployment by this tool.

## Preserved records and older execution environments

Historical result files and the website's recorded evidence retain their original
bytes and hashes. Readers accept the previous recognized format names, while new
results use Daidalis names. Existing project links in saved assistant messages
remain usable without rewriting the messages.

Legacy VM images can retain their original guest account, mounted folders and SSH
identity. The compatibility profile identifies those existing installations;
renaming the application does not rename files inside a guest disk or require a
new VM. New provisioning uses Daidalis names.

After switching, reload the browser and check the existing projects, model API
configuration, saved files and engineering plans. Confirm that an existing model
can be opened and a new task can use its configured tools. The normal [installation
guide](installation.md) and [Docker guide](docker.md) describe the updated names.
