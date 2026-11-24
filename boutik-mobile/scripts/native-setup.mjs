// Ajoute les autorisations nécessaires (caméra, Bluetooth, biométrie) aux projets Android et iOS.
// À lancer une fois après « npx cap add android » / « npx cap add ios ».
import fs from 'node:fs';

const am = 'android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(am)) {
  let x = fs.readFileSync(am, 'utf8');
  if (!x.includes('xmlns:tools')) x = x.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  const perms = [
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
    '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
    '<uses-permission android:name="android.permission.USE_BIOMETRIC" />'
  ].filter(p => !x.includes(p.split(' android:required')[0].split(' android:maxSdkVersion')[0].split(' android:usesPermissionFlags')[0]));
  if (perms.length) x = x.replace('<application', perms.map(p => '    ' + p).join('\n') + '\n\n    <application');
  fs.writeFileSync(am, x); console.log('✔ Android : autorisations ajoutées');
} else console.log('• Android absent (lancez « npx cap add android »)');

const pl = 'ios/App/App/Info.plist';
if (fs.existsSync(pl)) {
  let x = fs.readFileSync(pl, 'utf8');
  const keys = {
    NSCameraUsageDescription: 'Boutik utilise la caméra pour scanner les étiquettes et codes-barres des produits.',
    NSBluetoothAlwaysUsageDescription: 'Boutik utilise le Bluetooth pour imprimer les reçus et les étiquettes.',
    NSFaceIDUsageDescription: 'Boutik utilise Face ID pour la connexion du propriétaire.'
  };
  const add = Object.entries(keys).filter(([k]) => !x.includes('<key>' + k + '</key>')).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`).join('\n');
  if (add) { const i = x.lastIndexOf('</dict>'); x = x.slice(0, i) + add + '\n' + x.slice(i); }
  fs.writeFileSync(pl, x); console.log('✔ iOS : descriptions d\'autorisations ajoutées');
} else console.log('• iOS absent (sur Mac : « npx cap add ios --packagemanager CocoaPods »)');
