# Boutik : sortir la vraie application mobile (Android et iPhone)

L'application mobile utilise **exactement la même appli** que la version web (`boutik-server/public/index.html`), avec en plus des fonctions natives :

- **Scan Google ML Kit :** plusieurs étiquettes à la fois, aussi sur iPhone.
- **Imprimante Bluetooth native :** marche aussi sur iPhone.
- **Visage ou empreinte natifs** pour le propriétaire.
- **Exports partagés directement :** Excel, sauvegarde et étiquettes partent vers WhatsApp, l'e-mail, etc.

Gardez les deux dossiers **côte à côte** :

```
boutik/
├── boutik-server/   ← serveur + site + appli web (Render)
└── boutik-mobile/   ← ce dossier : application Android / iPhone
```

---

## 0. Une seule fois : installer les outils

| Pour | Il faut |
|---|---|
| Tout | **Node.js 22 ou plus** (nodejs.org) |
| Android | **Android Studio** (version Otter 2025.2.1 ou plus récente) — Windows, Mac ou Linux |
| iPhone | Un **Mac** avec **Xcode 26** ou plus récent, et CocoaPods (`sudo gem install cocoapods`) |

## 1. Régler l'application

1. **`boutik.config.json`** : mettez l'adresse de votre serveur Render.
   ```json
   { "server": "https://boutik.onrender.com" }
   ```
2. **`capacitor.config.json`** : choisissez l'identifiant définitif de l'application (`appId`), par exemple `com.votresociete.boutik`.
   ⚠️ **Il ne pourra plus changer après la première publication.**

## 2. Préparer le projet (dans le dossier `boutik-mobile`)

```bash
npm install
npm run build                     # copie l'appli web + crée le pont natif
npx cap add android
npx cap add ios --packagemanager CocoaPods     # seulement sur Mac
npm run native:setup              # ajoute caméra, Bluetooth, Face ID aux autorisations
npm run icons                     # génère icônes et écran de démarrage
npx cap sync
```

> Si `npm install` signale un conflit de versions entre les modules, lancez `npm install --legacy-peer-deps` et prévenez-moi : j'ajusterai les versions.

**Chaque fois que l'appli web change** (nouvelle version dans `boutik-server/public/index.html`) :
```bash
npm run build && npx cap sync
```

## 3. Android : tester puis publier sur Google Play

1. `npx cap open android` : Android Studio s'ouvre.
2. **Tester :** branchez un téléphone Android (mode développeur et débogage USB activés), puis appuyez sur ▶ *Run*. Vérifiez :
   - le scan (plusieurs étiquettes à la fois) ;
   - l'imprimante (Paramètres → Page de test) ;
   - le visage ou l'empreinte ;
   - le suivi à distance.
3. **Fabriquer le fichier à envoyer :** menu *Build → Generate Signed App Bundle* → *Android App Bundle (.aab)* → *Create new keystore*.
   ⚠️ **Gardez précieusement le fichier keystore et son mot de passe** (2 copies, hors de l'ordinateur). Sans eux, vous ne pourrez plus jamais mettre l'application à jour.
4. **Compte Google Play Console** (25 $ une seule fois) : créez l'application, puis envoyez le `.aab` en *Test interne* d'abord, puis en *Production*.
5. **Fiche du store, à remplir :**
   - **Politique de confidentialité :** `https://votre-adresse/confidentialite` (page déjà en ligne sur votre serveur, à faire relire par un juriste).
   - **Sécurité des données :**
     - données collectées : informations financières (achats et ventes), noms et téléphones (vendeurs, clients à crédit) ;
     - données chiffrées en transit ;
     - **suppression de compte : oui**, dans l'appli (Paramètres → Compte → Supprimer mon compte) **et** sur le web ;
     - **lien de suppression à indiquer :** `https://votre-adresse/suppression-compte` (page déjà en ligne sur votre serveur).
   - **Autorisations :**
     - caméra : scan des codes ;
     - Bluetooth : imprimante ;
     - biométrie : connexion du propriétaire.
   - **Captures d'écran** du téléphone (Caisse, Contrôle, Stock), une icône 512×512 (`boutik-server/public/icon-512.png`) et une bannière 1024×500.
   - **Public cible :** adultes (application professionnelle).
6. Une fois publiée, collez le lien Google Play dans **/admin → Réglages** : le bouton du site devient « Disponible sur Google Play ».

## 4. iPhone : tester puis publier sur l'App Store

1. Sur le Mac : `npx cap open ios` (Xcode s'ouvre).
2. Dans *Signing & Capabilities*, choisissez votre équipe (**compte Apple Developer, 99 $ par an**).
3. Testez sur un iPhone branché (▶).
4. Menu *Product → Archive*, puis *Distribute App → App Store Connect*.
5. **Dans App Store Connect :**
   - fiche, captures d'écran iPhone, lien de confidentialité, questionnaire « confidentialité de l'app » (mêmes réponses que pour Google) ;
   - pour la revue d'Apple, donnez un **compte de démonstration** : une boutique de test, le code du propriétaire et celui d'un vendeur.
   - **Pour éviter un refus**, expliquez dans les notes que l'appli fonctionne hors connexion, scanne plusieurs codes avec la caméra native, imprime en Bluetooth et utilise Face ID.
   - **Suppression de compte (règle 5.1.1(v)) :** indiquez dans les notes où elle se trouve : « Plus → Paramètres → Compte → Supprimer mon compte ». Elle efface la boutique du serveur et du téléphone.
6. Une fois publiée, collez le lien App Store dans **/admin → Réglages**.

## 5. Installer sans passer par les stores

**Android : oui.**
- **Fichier APK** : dans Android Studio, *Build → Generate Signed App Bundle / APK* → **APK**. Envoyez le fichier par WhatsApp ou mettez-le en téléchargement. Le commerçant autorise « Installer des applis inconnues » puis l'installe.
- ⚠️ Google impose peu à peu que toute appli installée sur un téléphone Android certifié vienne d'un **développeur vérifié** : déjà au Brésil, en Indonésie, à Singapour et en Thaïlande depuis septembre 2026, partout à partir de 2027. Créez votre compte (Play Console ou Android Developer Console) et enregistrez l'appli pour que vos APK restent installables.
- **Inconvénient** : pas de mise à jour automatique. Il faut renvoyer chaque nouvelle version.

**iPhone : pas vraiment.** Hors Union européenne (et Japon, Brésil), Apple n'autorise l'installation que depuis l'App Store. Solutions possibles :
- **Version web installable** (déjà prête, gratuite) : ouvrir `https://votre-adresse/app/` dans Safari → Partager → **Sur l'écran d'accueil**. L'icône Boutik apparaît comme une appli, hors connexion compris. Limites : scan en direct un peu moins rapide, pas d'imprimante Bluetooth sur iPhone, Face ID par le navigateur.
- **TestFlight** (avec le compte Apple Developer) : pour un pilote, jusqu'à 10 000 testeurs par lien d'invitation. Chaque version reste valable 90 jours. Pratique pour tester avant la publication, pas pour vendre.

**Conseil** : Android en APK + version web pour les iPhone suffisent pour le pilote. Passez par les stores pour vendre à grande échelle (confiance, mises à jour automatiques).

## En cas de souci

| Problème | Solution |
|---|---|
| La caméra ne s'ouvre pas | Réglages du téléphone → Applications → Boutik → Autorisations → Caméra |
| L'imprimante n'apparaît pas | Allumer l'imprimante, activer le Bluetooth et (Android ≤ 11) la localisation |
| « Serveur injoignable » | Vérifier l'adresse dans `boutik.config.json`, puis `npm run build && npx cap sync` |
| Écran blanc au scan sur Android | Normal pendant ½ seconde : la caméra s'affiche derrière l'appli |
