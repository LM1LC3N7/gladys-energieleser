# energieleser

Intégration non officielle, sans lien avec energieleser (nineti GmbH). Elle
lit un **stromleser**, le lecteur optique energieleser posé sur le port
infrarouge d'un compteur d'électricité allemand, par son API locale : pas de
cloud, pas de compte, rien d'envoyé au lecteur sinon une lecture toutes les
10 secondes.

**Jamais testé avec un vrai lecteur energieleser** : l'intégration a été
écrite à partir de la bibliothèque Python du fabricant (celle de Home
Assistant). Vos retours sont bienvenus.

## Ce que vous obtenez

Un appareil par lecteur, nommé d'après son identifiant
(`stromleser STROM_ONE_…`), avec les valeurs que donne le compteur (un
compteur n'en envoie qu'une partie) :

| Fonction                                  | Nature                          | Code du compteur       |
| ----------------------------------------- | ------------------------------- | ---------------------- |
| Puissance nette (négative en injection)   | capteur d'énergie, W            | 16.7.0                 |
| Index de consommation                     | index d'énergie, kWh            | 1.8.0                  |
| Index de consommation, tarifs 1 à 4 (kWh) | simple capteur                  | 1.8.1 à 1.8.4          |
| Index d'injection (kWh), tarifs 1 à 4     | simple capteur                  | 2.8.0 à 2.8.4          |
| Puissance prélevée, injectée, absolue (W) | simple capteur                  | 1.7.0, 2.7.0, 15.7.0   |
| Puissance L1, L2, L3 (W)                  | simple capteur, sans historique | 36.7.0, 56.7.0, 76.7.0 |
| Signal Wi-Fi (dBm)                        | simple capteur, sans historique | rssi                   |

- L'**index de consommation** alimente le suivi énergétique de Gladys, qui en
  tire la consommation et son coût. Il est publié chaque minute et vérifié
  d'abord : jamais 0 ; une baisse ou un saut que le foyer n'a pas pu
  consommer est **retenu** (la dernière valeur acceptée est renvoyée) et
  affiché dans l'état de l'intégration. S'il est juste (nouveau compteur,
  longue coupure), cliquez sur **Accepter l'index retenu** : exactement la
  valeur affichée est prise. Enregistrer la configuration ne l'accepte
  jamais.
- L'**injection** n'entre jamais dans le suivi énergétique (elle serait
  facturée comme une consommation) : simples capteurs.
- Les puissances sont envoyées toutes les 10 secondes, seulement quand elles
  changent (et toutes les 10 minutes sinon). Quand le lecteur ne donne plus
  de nouveau relevé pendant 5 minutes (tête optique déplacée), elles ne sont
  plus envoyées et l'état le dit.

## Installation

1. Installez l'application energieleser, posez le stromleser sur votre
   compteur et connectez-le à votre Wi-Fi, comme l'explique le fabricant.
2. Trouvez son adresse IP (dans votre box ou l'application) et donnez-lui de
   préférence une adresse fixe dans votre box.
3. Dans Gladys, ouvrez l'intégration, saisissez cette adresse, enregistrez.
4. Dans l'onglet **Découverte**, créez l'appareil.

Si l'état indique que le compteur ne donne pas de puissance, il est sans
doute verrouillé par PIN : saisissez sur le compteur le PIN donné par votre
gestionnaire de réseau pour débloquer ses données étendues. Les index
continuent en attendant.

## Boutons

- **Tester la connexion** : lit le lecteur quand une lecture est due (jamais
  plus d'une toutes les 10 secondes), sinon donne la dernière lecture.
- **Accepter l'index retenu** : voir plus haut.

## Limites

- Seul le **stromleser** (électricité) est lu. Un gasleser, wasserleser ou
  wärmeleser à l'adresse est reconnu et refusé, avec son nom.
- Un lecteur par intégration. Un autre lecteur qui répond à l'adresse (une IP
  qui a changé) a son propre appareil : ses valeurs ne vont jamais au
  précédent.
- Un index du compteur sans unité connue (Wh, kWh, MWh) n'est jamais utilisé.
- Lecture seule : le lecteur ne reçoit aucune commande.

## Dépannage

L'état de l'intégration dit ce qui se passe : adresse manquante, lecteur
injoignable (nouvel essai après 10 s, doublé jusqu'à 5 minutes), réponse
inattendue, index retenu. Pour regarder le lecteur vous-même, ouvrez
`http://<adresse>/v1/data` dans un navigateur sur le même réseau.
