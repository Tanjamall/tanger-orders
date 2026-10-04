package com.tanjamall.tangerorders;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppInstaller")
public class AppInstallerPlugin extends Plugin {
    @PluginMethod
    public void install(PluginCall call) {
        String address = call.getString("url");
        if (address == null || !address.startsWith("https://github.com/Tanjamall/tanger-orders/releases/download/")) {
            call.reject("Invalid update address.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().runOnUiThread(() -> getActivity().startActivity(settings));
            call.reject("Allow Tanger Orders to install updates, then tap Install update again.");
            return;
        }
        getBridge().execute(() -> {
            File apk = new File(getContext().getCacheDir(), "tanger-orders-update.apk");
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.connect();
                if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > 100_000_000L) throw new Exception("Update download failed.");
                long bytes = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        bytes += count;
                        if (bytes > 100_000_000L) throw new Exception("Update file is too large.");
                        output.write(buffer, 0, count);
                    }
                } finally { connection.disconnect(); }
                if (bytes < 100_000L) throw new Exception("Update file is incomplete.");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent installer = new Intent(Intent.ACTION_VIEW);
                installer.setDataAndType(uri, "application/vnd.android.package-archive");
                installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    try { getActivity().startActivity(installer); call.resolve(new JSObject()); }
                    catch (Exception error) { call.reject("Could not open the Android installer.", error); }
                });
            } catch (Exception error) {
                apk.delete();
                call.reject(error.getMessage() == null ? "Could not download the update." : error.getMessage(), error);
            }
        });
    }
}
