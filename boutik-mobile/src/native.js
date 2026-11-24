// Boutik — pont entre l'appli et les fonctions natives du téléphone.
// Compilé par « npm run build » vers www/native.js. L'appli l'utilise seulement quand elle tourne en application mobile.
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner, BarcodeFormat, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const FORMATS = [BarcodeFormat.QrCode, BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.Code128, BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code39];
let scanListener = null;

window.BoutikNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),

  // Scan : Google ML Kit, plusieurs codes à la fois, caméra affichée derrière l'appli
  scan: {
    async start(onCodes) {
      const p = await BarcodeScanner.requestPermissions();
      if (p.camera !== 'granted' && p.camera !== 'limited') throw new Error('permission caméra refusée');
      if (scanListener) { await scanListener.remove(); scanListener = null; }
      scanListener = await BarcodeScanner.addListener('barcodesScanned', ev => {
        onCodes((ev.barcodes || []).map(b => b.rawValue).filter(Boolean));
      });
      await BarcodeScanner.startScan({ formats: FORMATS, lensFacing: LensFacing.Back });
    },
    async stop() {
      try { if (scanListener) await scanListener.remove(); } catch (e) {}
      scanListener = null;
      try { await BarcodeScanner.stopScan(); } catch (e) {}
    }
  },

  // Imprimante de tickets Bluetooth (ESC/POS 58 mm)
  ble: {
    async connect(services) {
      await BleClient.initialize({ androidNeverForLocation: true });
      const dev = await BleClient.requestDevice({ optionalServices: services });
      const conn = { deviceId: dev.deviceId, name: dev.name || 'Imprimante', lost: false };
      await BleClient.connect(dev.deviceId, () => { conn.lost = true; });
      for (const s of await BleClient.getServices(dev.deviceId)) {
        for (const c of s.characteristics) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            Object.assign(conn, { service: s.uuid, characteristic: c.uuid, wnr: !!c.properties.writeWithoutResponse });
            return conn;
          }
        }
      }
      await BleClient.disconnect(dev.deviceId);
      throw new Error('imprimante non compatible');
    },
    async write(conn, bytes) {
      if (conn.lost) { await BleClient.connect(conn.deviceId, () => { conn.lost = true; }); conn.lost = false; }
      for (let i = 0; i < bytes.length; i += 180) {
        const part = bytes.slice(i, i + 180), view = new DataView(part.buffer, part.byteOffset, part.byteLength);
        if (conn.wnr) await BleClient.writeWithoutResponse(conn.deviceId, conn.service, conn.characteristic, view);
        else await BleClient.write(conn.deviceId, conn.service, conn.characteristic, view);
        await new Promise(r => setTimeout(r, 20));
      }
    }
  },

  // Visage / empreinte (ou code du téléphone en secours)
  bio: {
    async available() {
      try { const r = await BiometricAuth.checkBiometry(); return !!(r.isAvailable || r.deviceIsSecure); } catch (e) { return false; }
    },
    async auth(reason) {
      try {
        await BiometricAuth.authenticate({ reason, cancelTitle: 'Annuler', allowDeviceCredential: true, iosFallbackTitle: 'Utiliser le code', androidTitle: 'Boutik', androidSubtitle: reason });
        return true;
      } catch (e) { return false; }
    }
  },

  // Exports (Excel, sauvegarde, étiquettes) : enregistrés puis partagés (WhatsApp, e-mail, Drive…)
  async saveFile(name, content) {
    const r = await Filesystem.writeFile({ path: name, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, files: [r.uri] });
  }
};
