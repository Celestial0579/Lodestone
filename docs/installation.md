# Installing Lodestone

Lodestone currently supports Windows 7 (or higher) and macOS 10.9 (or higher).

### macOS

Download the `Lodestone.zip`, unpack the application and put it wherever you want.

### Windows

On Windows you have two options:

 - Download the `LodestoneSetup.exe` and run it to install it for the current user.
 - Download the `LodestoneSetup.msi` and run it to install a machine-wide version of Lodestone - each logged-in user will then be able to run Lodestone from the program at `%PROGRAMFILES(x86)\Lodestone Installer\desktop.exe`.

## Data Directories

Lodestone will create directories to manage the files and data it needs to function. If you manage a network of computers and want to install Lodestone, here is more information about how things work.

### macOS
 - `~/Library/Application Support/Lodestone/` - this directory contains user-specific data which the application requires to run, and is created on launch if it doesn't exist. Log files are also stored in this location.

### Windows

 - `%LOCALAPPDATA%\Lodestone\` - contains the latest versions of the app, and some older versions if the user has updated from a previous version.
 - `%APPDATA%\Lodestone\` - this directory contains user-specific data which the application requires to run, and is created on launch if it doesn't exist. Log files are also stored in this location.

## Log Files

Lodestone will generate logs as part of its normal usage, to assist with troubleshooting. They are located in the data directory that Lodestone uses (see above) under a `logs` subdirectory, organized by date using the format `YYYY-MM-DD.desktop.production.log`, where `YYYY-MM-DD` is the day the log was created.

## Installer Logs

Problems with installing or updating Lodestone are tracked in a separate file which is managed by the updater frameworks used in the app.

### macOS

 - `~/Library/Caches/com.github.GitHubClient.ShipIt/ShipIt_stderr.log` - this file will contain details about why the installation or update failed - check the end of the file for recent activity.

### Windows

 - `%LOCALAPPDATA%\Lodestone\SquirrelSetup.log` - this file will contain details about update attempts for Lodestone after it's been successfully installed.
 - `%LOCALAPPDATA%\SquirrelSetup.log` - information about the initial installation may be found here. As this framework is used by different apps, it may also contain details about other apps. Ensure that you focus on mentions of `Lodestone.exe` in the log.

