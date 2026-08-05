# Publishing Shree updates

Public updates are published by the GitHub Actions release workflow. The GitHub repository and its Releases must be public so installed copies can download updates without a personal access token. Version 1.1.39 is an explicitly unsigned early-access bootstrap release; Windows may display an Unknown publisher warning. Before a production release, add a trusted Windows code-signing certificate as the repository secrets `CSC_LINK` and `CSC_KEY_PASSWORD` and restore certificate enforcement in the workflow. Push a tag matching `package.json`, for example `v1.1.39`.

The workflow verifies versions and tests, builds the React application and Python sidecar, signs the NSIS installer, and publishes the installer, blockmap, and channel metadata to the repository release. Installed copies check that HTTPS feed after startup and every eight hours. Stable users receive stable releases; beta and alpha channels are opt-in.

Do not replace or delete published update metadata while users may still be on an older version. Never reuse a version number. If a release is bad, publish a higher patch version containing the fix.

User data is intentionally outside the installation directory under `%LOCALAPPDATA%\SHREE`, Electron preferences remain in Electron's user-data directory, and API keys remain in Windows Credential Manager. Installing or uninstalling the application does not silently remove this data.

Versions older than 1.1.39 did not contain a public update-feed identity, so they cannot be changed remotely. Existing users must install the signed 1.1.39 bootstrap installer once. From 1.1.39 onward, updates published by this workflow appear inside Shree automatically and preserve the same local profile.
