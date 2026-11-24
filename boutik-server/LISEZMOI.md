# Boutik — mise en ligne

Boutik est une caisse, un stock et un contrôle des vendeurs, dans une seule appli. Ce dossier contient :

- `public/` : l'appli elle-même ;
- `server.js` : le petit serveur qui synchronise la boutique et le téléphone du propriétaire. Il n'a besoin d'aucune dépendance (Node 18 ou plus).

## Mettre en ligne sur Render

1. Mettez ce dossier dans un dépôt GitHub.
2. Sur Render, créez un **New → Web Service** et choisissez le dépôt.
3. Réglages :
   - Runtime : **Node**
   - Build command : *(laisser vide)*
   - Start command : `node server.js`
4. **Variables d'environnement** (Settings → Environment) :
   - `ADMIN_PASSWORD` : votre mot de passe pour la console éditeur (**10 caractères minimum**). Sans lui, la console est désactivée.
   - `SUPPORT_CONTACT` : ce que voient vos clients quand leur abonnement expire, par exemple `Egalyx — WhatsApp +225 07 00 00 00 00`.
   - `TRIAL_DAYS` : jours d'essai gratuit (défaut 30) · `GRACE_DAYS` : jours de tolérance après expiration (défaut 7).
5. **Important, pour ne pas perdre les données :** ajoutez un **Disk** (Settings → Disks), monté sur `/var/data`. Ajoutez ensuite la variable d'environnement `DATA_DIR=/var/data`.
   Sur l'offre gratuite de Render, il n'y a pas de disque : les données en ligne sont effacées à chaque redémarrage. Les téléphones gardent malgré tout leur copie et la renvoient.
6. Adresses :
   - `https://votre-adresse/` : le **site vitrine** de Boutik (tarif, contact, liens des stores) ;
   - `https://votre-adresse/app/` : l'**appli web**, à ouvrir dans Chrome sur le téléphone puis « Installer l'appli » ;
   - `https://votre-adresse/admin` : votre **console éditeur** ;
   - `https://votre-adresse/confidentialite` : la **politique de confidentialité**, demandée par Google et Apple.

## Premier démarrage

1. **Téléphone de la boutique :** créez la boutique, puis allez dans Plus → Paramètres → « Mettre ma boutique en ligne ».
2. Touchez « Connecter un autre téléphone » : un QR code s'affiche.
3. **Téléphone du propriétaire :** ouvrez la même adresse, touchez « Rejoindre ma boutique » et scannez ce QR code.

Le code de jumelage donne accès à toute la boutique. Ne le partagez qu'avec vos propres téléphones.

## Tester sur un ordinateur

```
node server.js
```

Puis ouvrez http://localhost:3000. Le port se change avec la variable `PORT`.

## Fonctions paramétrables

Dans Plus → **Fonctions de l'appli**, le propriétaire active ou coupe chaque module : crédit, Mobile Money, carton et kilo, prix de gros, marchandage, remises, photos, ouverture de caisse, comptage à l'aveugle, référence MoMo obligatoire, vérification MoMo, dépenses, fournisseurs, imprimante Bluetooth, annonces vocales, plusieurs boutiques. On y choisit aussi la langue des écrans vendeurs : français, anglais, kiswahili, hausa, wolof, bambara, dioula, lingala, ou une autre langue à écrire soi-même. Les traductions africaines sont des propositions à faire relire ; chaque phrase se corrige dans « Traductions ».

## Imprimante Bluetooth

Elle fonctionne avec les mini-imprimantes de tickets 58 mm de type ESC/POS, dans **Chrome sur Android**. La plupart sont compatibles. Testez d'abord avec « Page de test » dans Paramètres.

Sur iPhone, l'impression Bluetooth n'est pas possible : le navigateur ne le permet pas.

## Console éditeur (super-admin)

Elle se trouve à l'adresse `https://votre-adresse/admin`, protégée par `ADMIN_PASSWORD`. Après 4 mots de passe faux, l'accès est bloqué 15 minutes.

- **Liste de toutes les boutiques clientes :** activité, ventes des 30 derniers jours, téléphones connectés, fiche client.
- **Abonnements :**
  - chaque nouvelle boutique a un essai gratuit ;
  - vous enregistrez un paiement (1, 3, 6 ou 12 mois), ce qui prolonge l'abonnement ;
  - vous pouvez offrir des jours, suspendre une boutique ou relancer le client sur WhatsApp.
- **Si l'abonnement expire** (après le délai de grâce) ou si la boutique est suspendue, ses téléphones **continuent de vendre** mais ne se synchronisent plus. Le commerçant voit un message avec votre contact.
- **Nouveau code de jumelage :** en cas de téléphone perdu ou de code divulgué. Tous les téléphones de la boutique devront se reconnecter.
- **Vos revenus** du mois et au total, et un export Excel de vos clients.

## Connexion par visage ou empreinte (propriétaire)

Dans Plus → Paramètres → Sécurité → « Activer sur ce téléphone ». Le téléphone utilise ce qu'il sait faire : Face ID, l'empreinte, le visage sous Android, ou à défaut son code de verrouillage. Boutik ne voit et ne stocke jamais le visage ni l'empreinte. Il faut une adresse en https, ce qui est le cas sur Render.

À activer uniquement sur le téléphone du propriétaire : toute personne enregistrée dans ce téléphone pourrait entrer. Le code secret reste toujours valable en secours.

## Site vitrine

Les textes sont dans `public/site.html`. Le prix, le WhatsApp commercial, l'e-mail, le nom de l'éditeur et les liens Google Play et App Store se règlent dans **/admin → Réglages**, sans toucher au code.

## Application mobile (stores)

Voir le dossier `boutik-mobile` et son guide `GUIDE-STORES.md`.

## Assistant

L'assistant (bouton ✦ en haut de l'appli) répond **sans internet** :
- aux questions sur les ventes, le bénéfice, le stock, les vendeurs, les crédits et les fournisseurs ;
- aux questions sur l'utilisation de l'appli ;
- avec des **conseils** calculés sur les vrais chiffres.

Un vendeur n'obtient jamais les marges, les prix d'achat ni l'argent attendu.

**Option IA en ligne (facultative)** pour les questions libres :
1. Créez une clé API sur console.anthropic.com.
2. Sur Render, ajoutez la variable `ANTHROPIC_API_KEY`.
3. Facultatif : `AI_MODEL` (défaut `claude-haiku-5-5`) et `AI_DAILY_LIMIT` (questions par boutique et par jour, défaut 60).
4. Chaque boutique active ensuite « Assistant IA en ligne » dans Fonctions.

Les questions en ligne sont facturées par Anthropic sur votre compte : gardez une limite par jour.

## Tarifs, codes promo et facturation

Tout se règle dans la console `/admin` → **Réglages**, et s'applique partout : site, appli, relances WhatsApp.
- **Prix catalogue** : il s'affiche barré (défaut 25 000).
- **Prix actuel** : 20 000 par mois.
- **Prix annuel** : défaut 200 000.
- **Codes promo** :
  - remise en FCFA, « par mois » ou « une fois » ;
  - date de fin et nombre maximum d'utilisations ;
  - le compteur d'utilisations monte à chaque paiement enregistré.
  - Le commerçant saisit le code dans l'appli (Paramètres → Mon abonnement Boutik), ou vous l'appliquez dans sa fiche.
- **Mensuel ou annuel** : à choisir boutique par boutique, dans sa fiche → **Formule**. Le montant à encaisser est calculé tout seul.

## Matériel en vente

Ajoutez dans Réglages les imprimantes et les rouleaux d'étiquettes que vous vendez : nom, prix, description, photo. Ils s'affichent :
- dans l'appli (Plus → Imprimantes et étiquettes) ;
- sur le site, avec un bouton pour commander sur votre WhatsApp commercial.

## Comptage par photo (IA)

Même clé `ANTHROPIC_API_KEY` que l'assistant. Le commerçant active « Comptage par photo (IA) » dans Fonctions. Dans le scanner, le bouton **Compter (IA)** estime le nombre d'articles sans étiquette :
- l'IA reçoit aussi les photos des produits enregistrées dans Stock (12 au plus, en petit format) pour ne pas confondre les variantes ;
- le résultat est corrigeable, puis passe par le **recensement** normal : le patron voit les écarts et coche ce qu'il corrige, et un vendeur l'envoie au patron ;
- chaque comptage par photo est noté dans le journal. Le scanner compte aussi, sans IA, les étiquettes QR visibles.
