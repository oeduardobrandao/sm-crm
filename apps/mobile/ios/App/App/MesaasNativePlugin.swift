import UIKit
import Security
import Capacitor

/// The app's own plugin: Keychain storage for the Supabase session, the APNs
/// environment of this build, opening Settings or Safari, and saving media through
/// the share sheet.
/// The JS side is apps/crm/src/native/mesaasNative.ts: method names and result
/// shapes must match it.
@objc(MesaasNativePlugin)
public class MesaasNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MesaasNativePlugin"
    public let jsName = "MesaasNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "keychainGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainRemove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deviceInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFiles", returnType: CAPPluginReturnPromise)
    ]

    private static let keychainService = "br.com.mesaas.app"
    private static let installedFlag = "mesaas.installed"

    override public func load() {
        Self.wipeKeychainAfterInstallIfNeeded()
    }

    /// Keychain items survive an uninstall, UserDefaults don't. On the first launch
    /// after an install the flag is missing, so every item of our service goes: a
    /// reinstall must not restore the previous session. Runs at plugin registration,
    /// before the web view loads, so it always precedes the first keychainGet.
    private static func wipeKeychainAfterInstallIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: installedFlag) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService
        ]
        let status = SecItemDelete(query as CFDictionary)
        // Only mark the install as handled when the wipe went through, so a
        // transient failure (device still locked) retries on the next launch.
        if status == errSecSuccess || status == errSecItemNotFound {
            defaults.set(true, forKey: installedFlag)
        } else {
            CAPLog.print("MesaasNative: keychain wipe after install failed (\(status))")
        }
    }

    private static func baseQuery(account: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
    }

    // MARK: - Keychain

    @objc func keychainGet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            return call.reject("Must provide key")
        }
        var query = Self.baseQuery(account: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
                return call.reject("Keychain item is not UTF-8 text")
            }
            call.resolve(["value": value])
        case errSecItemNotFound:
            call.resolve(["value": NSNull()])
        default:
            call.reject("Keychain read failed", String(status))
        }
    }

    @objc func keychainSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            return call.reject("Must provide key")
        }
        guard let value = call.getString("value") else {
            return call.reject("Must provide value")
        }

        let query = Self.baseQuery(account: key)
        let deleteStatus = SecItemDelete(query as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            return call.reject("Keychain write failed", String(deleteStatus))
        }

        var attributes = query
        attributes[kSecValueData as String] = Data(value.utf8)
        // This device only: never synced to iCloud Keychain, never restored from a backup.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            return call.reject("Keychain write failed", String(status))
        }
        call.resolve()
    }

    @objc func keychainRemove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            return call.reject("Must provide key")
        }
        let status = SecItemDelete(Self.baseQuery(account: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            return call.reject("Keychain delete failed", String(status))
        }
        call.resolve()
    }

    // MARK: - Device

    @objc func deviceInfo(_ call: CAPPluginCall) {
        // Debug builds (Xcode, Simulator) talk to the APNs sandbox; TestFlight and
        // App Store builds are Release and use production APNs.
        #if DEBUG
        let pushEnvironment = "sandbox"
        #else
        let pushEnvironment = "production"
        #endif

        let info = Bundle.main.infoDictionary
        let shortVersion = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        call.resolve([
            "pushEnvironment": pushEnvironment,
            "appVersion": "\(shortVersion) (\(build))"
        ])
    }

    // MARK: - Outside the app

    @objc func openSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            return call.reject("Settings URL unavailable")
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                opened ? call.resolve() : call.reject("Could not open Settings")
            }
        }
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              url.scheme?.lowercased() == "https",
              url.host?.isEmpty == false else {
            return call.reject("Only https URLs can be opened")
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                opened ? call.resolve() : call.reject("Could not open URL")
            }
        }
    }

    // MARK: - Saving media

    /// Downloads `files` ([{ url, filename }]) to a temporary folder and presents the
    /// share sheet with them ("Save Image" / "Save Video" need
    /// NSPhotoLibraryAddUsageDescription). Resolves `{ completed }` once the sheet
    /// closes. The web view can't do this for videos: a Reel is ~180 MB, which the page
    /// would hold in memory, and WebKit only opens the sheet within seconds of a tap.
    @objc func shareFiles(_ call: CAPPluginCall) {
        guard let entries = call.getArray("files", JSObject.self), !entries.isEmpty else {
            return call.reject("Must provide files")
        }

        var sources: [(url: URL, filename: String)] = []
        for entry in entries {
            guard let raw = entry["url"] as? String, let url = URL(string: raw),
                  Self.isAllowedDownload(url) else {
                return call.reject("Only https URLs can be downloaded")
            }
            let name = Self.safeFilename(entry["filename"] as? String, fallback: url.lastPathComponent)
            sources.append((url, name))
        }

        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("mesaas-share", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return call.reject("Could not prepare the download")
        }

        Task {
            var saved: [URL] = []
            do {
                for (index, source) in sources.enumerated() {
                    saved.append(try await Self.download(source.url, into: folder, as: source.filename, index: index))
                }
            } catch let error as DownloadError {
                try? FileManager.default.removeItem(at: folder)
                return call.reject(error.message, error.code)
            } catch {
                try? FileManager.default.removeItem(at: folder)
                return call.reject("Download failed", "NETWORK")
            }
            await MainActor.run { self.presentShareSheet(saved, folder: folder, call: call) }
        }
    }

    private struct DownloadError: Error {
        let message: String
        let code: String
    }

    /// https only; Debug builds also take http so a Simulator build can use a local server.
    private static func isAllowedDownload(_ url: URL) -> Bool {
        guard url.host?.isEmpty == false else { return false }
        let scheme = url.scheme?.lowercased()
        #if DEBUG
        return scheme == "https" || scheme == "http"
        #else
        return scheme == "https"
        #endif
    }

    /// The last path component only, so a name can never leave the temporary folder.
    private static func safeFilename(_ raw: String?, fallback: String) -> String {
        let candidate = (raw ?? "").components(separatedBy: CharacterSet(charactersIn: "/\\:")).last ?? ""
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, trimmed != ".", trimmed != ".." { return trimmed }
        return fallback.isEmpty ? "arquivo" : fallback
    }

    private static func download(_ url: URL, into folder: URL, as filename: String, index: Int) async throws -> URL {
        let (tempFile, response) = try await URLSession.shared.download(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            try? FileManager.default.removeItem(at: tempFile)
            throw DownloadError(message: "HTTP \(http.statusCode)", code: "HTTP_\(http.statusCode)")
        }
        // Each file in its own subfolder: two slides can share an original name.
        let slot = folder.appendingPathComponent(String(index), isDirectory: true)
        try FileManager.default.createDirectory(at: slot, withIntermediateDirectories: true)
        let destination = slot.appendingPathComponent(filename)
        try FileManager.default.moveItem(at: tempFile, to: destination)
        return destination
    }

    private func presentShareSheet(_ files: [URL], folder: URL, call: CAPPluginCall) {
        guard var presenter = bridge?.viewController else {
            try? FileManager.default.removeItem(at: folder)
            return call.reject("No screen to present on")
        }
        while let top = presenter.presentedViewController { presenter = top }

        let sheet = UIActivityViewController(activityItems: files, applicationActivities: nil)
        var settled = false
        sheet.completionWithItemsHandler = { _, completed, _, _ in
            guard !settled else { return }
            settled = true
            try? FileManager.default.removeItem(at: folder)
            call.resolve(["completed": completed])
        }
        // iPad shows the sheet as a popover, which crashes without an anchor.
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }
}
