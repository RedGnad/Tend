# Audit adversarial — Squads Protocol v4 `spending_limits` comme rail de cashback live pour Tend

**Auditeur** : revue à charge, commandée par le builder Tend
**Date d'audit** : 2026-04-19
**Objet** : décider si Tend peut s'appuyer sur Squads v4 `spending_limit_use` comme primitive de paiement pour cashback live (10–200 payouts/jour par campagne, 100+ campagnes, min 0.001 SOL par payout, signature par agent backend)
**Méthode** : clone du dépôt `Squads-Protocol/v4` à `edbca83` (2026-04-15), lecture des 3 audits publics (Neodyme, OtterSec, Certora), vérification on-chain via RPC mainnet (`api.mainnet-beta.solana.com`), recoupement blog + GitHub
**Posture** : chercher activement les raisons de NE PAS partir sur Squads. Par défaut je casse le plan.

---

## 1. EXECUTIVE SUMMARY — VERDICT

**CONDITIONAL GO**. Pas de deal-breaker dur pour le cas d'usage cashback Tend. La surface d'attaque a été auditée 3x dont une vérification formelle Kani/Certora, le programme est immutable sur mainnet, et 32 287 `SpendingLimit` actifs prouvent que la primitive est utilisée en prod. **Les vraies frictions sont opérationnelles** : période minimum 1 jour (pas de fenêtre horaire), reset non-rolling, et coût rent ~1.8× vs PDA custom. Ça passe pour Tend, mais ça ne passe pas par magie — voir §9 caveats.

---

## 2. DEAL-BREAKERS IDENTIFIÉS

**Aucun deal-breaker absolu identifié.**

Ce qui s'en rapproche le plus et doit être explicitement accepté par le produit :

| Point bloquant potentiel | Verdict | Impact réel sur Tend |
|---|---|---|
| Période de reset minimum = 1 jour (enum `Period::{OneTime,Day,Week,Month}`, pas de seconde custom) | **Non-bloquant** | Une campagne avec budget "X SOL par jour" fonctionne. Une campagne "X SOL par heure" ne peut pas être exprimée directement côté on-chain — il faut soit accepter la granularité jour, soit découper en plusieurs SpendingLimits, soit gérer la limite applicativement côté agent. |
| Reset non-rolling : quand un jour s'écoule, `remaining_amount = amount` en entier, pas glissant | **Non-bloquant** | Un créateur peut "déverser" le budget d'un jour en 1 tx. Si le produit promet un rate-limit fin par seconde/minute, ce n'est pas Squads qui l'enforce — c'est l'agent Tend. |
| Programme AGPL-3.0 | **Non-bloquant pour Tend** | On consomme un programme on-chain déjà déployé — AGPL concerne la redistribution du code source. Tant qu'on ne redistribue pas de binaire Tend contenant le code Squads, la contrainte ne mord pas. À re-vérifier avec un avocat avant toute license commerciale. |
| Smart Account Program (v5 précurseur) lancé sur mainnet 2026-04-14 | **Non-bloquant** | Le v4 reste maintenu (dernier commit 2026-04-15), immutable, utilisé par 150 902 multisigs. Mais il faut prévoir un plan de migration 12–24 mois. |

Niveau de confiance sur l'absence de deal-breaker : **haut** sur la partie on-chain (code lu ligne à ligne), **moyen** sur la partie légale AGPL (non confirmée par conseil juridique).

---

## 3. LIMITES TECHNIQUES DU PROGRAMME

### 3.1 Périodes disponibles
Source : `programs/squads_multisig_program/src/state/spending_limit.rs:83-104`
```rust
pub enum Period { OneTime, Day, Week, Month }
impl Period {
    pub fn to_seconds(&self) -> Option<i64> {
        match self {
            Period::OneTime => None,           // jamais reset
            Period::Day => Some(86_400),        // 24h fixes
            Period::Week => Some(604_800),      // 7 jours
            Period::Month => Some(2_592_000),   // 30 jours forfaitaires
        }
    }
}
```
**Pas de granularité horaire, pas de seconde custom**. J'ai grep le code pour confirmer : aucune variante `Custom(i64)`. Les blog posts externes qui mentionnent "custom seconds" parlent de `time_lock` sur les transactions multisig, pas de `spending_limit.period`.

### 3.2 Logique de reset (non-rolling)
Source : `spending_limit_use.rs:149-163`
```rust
if passed_since_last_reset > reset_period {
    spending_limit.remaining_amount = spending_limit.amount;  // reset full, pas glissant
    spending_limit.last_reset += periods_passed * reset_period;
}
```
À noter : condition `>` stricte. Si exactement `reset_period` secondes se sont écoulées, le reset ne déclenche pas encore. Edge case à 1 seconde près, sans impact pratique.

### 3.3 Contraintes SOL spécifiques
`spending_limit_use.rs:182` : `require!(args.decimals == 9, MultisigError::DecimalsMismatch);` — pour SOL natif, l'agent Tend doit toujours passer `decimals: 9`. Sanity check anti-erreur d'ordre de grandeur.

### 3.4 Destinations
`spending_limit.rs:47` et `spending_limit_use.rs:122-130` : **si `destinations` est vide, toute adresse est acceptée**. C'est ce que Tend veut — cashback vers le trader qui vient de swap, on ne peut pas pré-connaître son wallet. **Cette propriété est critique pour Tend et elle est explicitement supportée**.

### 3.5 Members de SpendingLimit
`spending_limit.rs:41-43` : `/// Don't have to be members of the multisig.`
`spending_limit_use.rs:99-102` : la validation vérifie `spending_limit.members.contains(&member.key())` **sans** re-vérifier que ce membre est toujours membre du multisig parent. C'est un choix de design conscient — Tend peut autoriser un signer hot-wallet agent dédié, même s'il n'a aucun pouvoir sur le multisig lui-même. **Bon pour notre archi** : la clé de signature de l'agent n'a besoin que du droit `spending_limit_use`, pas du droit d'ajouter/retirer des membres.

### 3.6 Instruction atomique, batchable
`spending_limit_use` est une instruction Anchor unique (pas un flux propose/vote/execute). Donc :
- 1 tx = 1 ou plusieurs cashbacks (jusqu'à la limite CU ~200k d'une tx standard, ~1.4M en tx v0 avec request_heap_frame).
- Signature backend : seule la clé `member` signe + feepayer. Pas de threshold, pas de proposal, pas de vote.
- Batchable : plusieurs `spending_limit_use` ix sur différents `SpendingLimit` dans une même tx — utile pour regrouper les cashbacks inter-campagnes.

### 3.7 Coût CU
Non mesuré directement sur mainnet lors de cet audit (les logs transaction individuels ne sont pas remontés par l'explorer pour chaque ix discriminator dans le temps imparti). Estimation par analyse du code : 1 CPI SOL transfer + 1 ou 2 account writes + 1 Clock sysvar read → ordre de grandeur **~20k–40k CU par `spending_limit_use` SOL**, vs ~450 CU pour un `system_program::transfer` direct. **~50×–90× plus cher en CU** qu'un transfer brut. Non-bloquant (on est très loin de saturer la limite), mais c'est un fee différentiel. Niveau de confiance : **moyen**, à mesurer précisément avec une tx de simulation avant prod.

**Confiance section 3 : haut** (code lu ligne à ligne, sauf coût CU exact = moyen).

---

## 4. ADOPTION RÉELLE ET MATURITÉ

### 4.1 Programme déployé et immutable
- Program ID : `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (source : `programs/squads_multisig_program/src/lib.rs:declare_id!`)
- Vérifié via RPC `getAccountInfo` sur `ProgramData` PDA : **upgrade authority = None**. Le programme est **immutable on-chain**. Plus aucun humain ne peut redéployer ce bytecode.

### 4.2 Adoption on-chain (RPC mainnet, 2026-04-19)
- `getProgramAccounts` filtré sur le discriminator Anchor `Multisig` : **150 902 comptes actifs**.
- `getProgramAccounts` filtré sur le discriminator Anchor `SpendingLimit` : **32 287 comptes actifs**.
- `ProgramConfig.multisig_creation_fee` actuel : **0 lamports** (vérifié sur le PDA config ; les blog posts mentionnant "0.1 SOL de frais" sont obsolètes).

Ce n'est pas un jouet : 32k spending_limits en prod = primitive éprouvée par le marché.

### 4.3 Maintenance active
47 commits depuis juin 2025. Dernier commit : 2026-04-15. Tag de version récent (2026-04-14). Le repo reçoit régulièrement des contributeurs externes (`cavemanloverboy`, `ND-Benjamin`, etc.). Projet vivant.

### 4.4 Signal v5 / Smart Account Program
Squads a lancé un "Smart Account Program" sur mainnet le 2026-04-14 (précurseur de v5). La feature `spending_limits` **n'y est pas encore portée**. Le v4 reste le seul rail pour cette primitive à l'heure de l'audit.

**Risque produit** : si tous les utilisateurs institutionnels migrent vers v5 d'ici 2027, le v4 pourrait devenir un rail "legacy". Ça ne casse pas Tend (programme immutable, marche indéfiniment tant que Solana tourne), mais ça peut obliger à ré-implémenter sur v5 à moyen terme pour rester aligné sur l'écosystème.

**Confiance section 4 : haut** (données RPC fraîches + git log + source primaire).

---

## 5. INCIDENTS ET AUDITS DE SÉCURITÉ

### 5.1 Couverture audit
Trois rapports publics dans le dépôt `audits/` :

| Audit | Scope | Findings non résolus |
|---|---|---|
| **Neodyme 2024** | Delta depuis l'audit Feb 2024 | 0 Critical, 0 High, 0 Medium, 1 Low (DoS `TransactionBuffer`) — résolu |
| **OtterSec 2024** | Full incluant vérification formelle Kani | 3 Low + 3 Informational — tous résolus, dont OS-SQD-SUG-00 sur spending_limit member checks |
| **Certora 2024** | Full + vérification formelle | 1 High + 2 Low + 2 Informational — tous résolus. Toutes les findings concernaient `TransactionBuffer`, jamais `SpendingLimit`. Seule finding SpendingLimit : I-01 "comment mismatch" |

Les vérifications formelles (Certora + Kani) couvrent explicitement :
- Automate de states `Proposal`
- Non-malléabilité des transactions
- Invariants `SpendingLimitUse` (les accounts passés correspondent à la PDA dérivée)
- Unicité de signature

C'est au-dessus de la moyenne des programmes Solana. Très rares sont les protocoles qui cumulent 2 audits + 2 vérifications formelles + bytecode immutable.

### 5.2 CVE et incidents post-audit
Recherche publique : **aucun incident public majeur** sur Squads v4 depuis les audits (mi-2024). Le programme n'a pas été compromis. TVL sous gestion de Squads = infrastructure multisig parmi les plus utilisées sur Solana (Jito, Marinade, etc. ont historiquement utilisé Squads pour leurs treasuries).

### 5.3 Surface résiduelle
- Bug non découvert dans un programme immutable = tout le monde y compris Tend est exposé, pas de patch possible. Mitigation : limiter le `amount` par `SpendingLimit` au budget réel de campagne. Pas de "blanket authority" sur un vault qui contiendrait 100 SOL.
- Dépendance `anchor-lang` et `anchor-spl` — surfaces indirectes mais bien testées.

**Confiance section 5 : haut** (rapports PDF lus dans le détail).

---

## 6. COÛTS ON-CHAIN

### 6.1 Rent calculé (à partir du code)

Taille de compte `Multisig` avec 1 member (`multisig.rs:size()`) = **165 bytes**.
Taille de compte `SpendingLimit` avec 1 member + 0 destination (`spending_limit.rs:size()`) = **171 bytes**.

Rent-exempt lamports (formule Solana = `(bytes + 128) * 6960`) :
- Multisig : 0.00408 SOL
- SpendingLimit : 0.00416 SOL
- **Setup par campagne Squads = 0.00824 SOL**

Un PDA custom minimaliste (200 bytes) coûterait **~0.00457 SOL**.

### 6.2 Extrapolation Tend

| Cible | Squads | PDA custom |
|---|---|---|
| 100 campagnes (setup) | **0.82 SOL** | 0.46 SOL |
| 1 000 campagnes (setup) | **8.2 SOL** | 4.6 SOL |

**~1.8× plus cher en rent que la version custom**. Pas un deal-breaker (la rent est récupérable en fermant les comptes, et 0.82 SOL ≈ 100 USD au cours actuel pour 100 campagnes). Mais c'est un coût réel à supporter par Tend ou à répercuter au créateur à l'onboarding.

### 6.3 Frais de création
`program_config.multisig_creation_fee` actuel = **0 lamports** (vérifié on-chain). L'authority pourrait relever ce fee demain. Il faut surveiller ce paramètre si on scale.

### 6.4 Frais par payout
Un `spending_limit_use` = 1 tx Solana standard. Base fee 5000 lamports + priority fee variable. Négligeable à l'échelle d'un cashback de 0.001 SOL minimum (fee = 0.5% du payout dans le pire cas, à ajuster avec priority fee dynamique).

**Confiance section 6 : haut** pour rent (code + formule déterministe). **Moyen** pour coût réel priority fee en prod.

---

## 7. DÉPENDANCE VENDOR ET LICENCE

### 7.1 Licence AGPL-3.0
Le code Squads v4 est AGPL-3.0. **Implications pour Tend** :
- Tend ne redistribue pas le bytecode Squads — on appelle un programme déployé on-chain. La clause AGPL de "distribution" est discutable dans ce contexte Solana.
- Tend ne redistribue pas non plus le code source Rust de Squads.
- MAIS : si Tend fork Squads pour y ajouter des features (ex. period `Hour` custom), Tend doit publier son fork en AGPL. Fork bloqué pour usage commercial propriétaire.

**Conclusion** : consommer le programme mainnet = OK. Forker = contrainte licence. À faire valider par un conseil juridique avant toute monétisation B2B.

### 7.2 Dépendance à l'équipe Squads
- Programme immutable = **Tend ne dépend pas de l'équipe Squads pour que les transactions continuent à passer**. C'est le vrai avantage : si Squads Inc. disparaît demain, nos cashbacks continuent.
- SDK TypeScript (`@sqds/multisig`) dépend de l'équipe pour les nouveaux builds. Non-bloquant : on peut forker le SDK ou se contenter de construire les ix à la main (le layout Anchor est public, on a la source).

### 7.3 Migration v5
Si Squads pousse v5 (via le Smart Account Program) et déprécie v4 publiquement, Tend peut :
1. Rester sur v4 indéfiniment (programme immutable).
2. Migrer les nouvelles campagnes sur v5, laisser les anciennes sur v4.
Aucune rupture forcée.

**Confiance section 7 : moyen** (la partie AGPL requiert validation juridique).

---

## 8. LATENCE, UX ET INTÉGRATION AGENT BACKEND

### 8.1 Latence on-chain
`spending_limit_use` = 1 tx Solana. Finalité economique sur mainnet ≈ 400–1200 ms en conditions normales. **Compatible avec "cashback quelques secondes après un swap"**, largement.

### 8.2 Signature côté agent
- Un seul signer nécessaire : un member du SpendingLimit. Pas de threshold, pas de round-trip multisig.
- Tend assigne une clé hot-wallet dédiée par campagne (ou partagée) comme member du SpendingLimit.
- **Conséquence sécu** : la clé hot-wallet de l'agent a un **blast radius limité au `amount` de la période**. Si la clé est compromise, l'attaquant peut drainer au maximum `remaining_amount` par période, vers n'importe quelle destination (car `destinations` est vide dans notre cas). **C'est le modèle de risque central à accepter**.

### 8.3 Setup flow par campagne
Côté UX créateur :
1. Tx 1 : `multisig_create_v2` — crée le multisig (payé par Tend ou le créateur).
2. Tx 2 : transfert SOL budget vers `vault` PDA du multisig.
3. Tx 3 : `multisig_add_spending_limit` — doit être signé par le `config_authority` (donc multisig "contrôlé" si on veut éviter le flux proposal/vote/execute).

**Deux transactions minimum avant que la campagne soit live**, trois si on compte le transfert du budget. Pas un deal-breaker mais pas gratuit en UX.

### 8.4 Alternative : un seul multisig Tend, N SpendingLimits
Pattern recommandé : **un multisig "Tend master" contrôlé par Tend, et N `SpendingLimit` enfants, un par campagne**. Réduit le coût rent à `0.00408 + N × 0.00416` au lieu de `N × 0.00824`. Gain sur 100 campagnes : 0.41 SOL. Seul inconvénient : les fonds de toutes les campagnes sont comptablement dans un seul vault (séparation logique par `SpendingLimit.amount`, pas par vault index).

Note : `vault_index` sur SpendingLimit permet de router vers des vaults différents dans le même multisig, donc **on peut ségréger les fonds par campagne via `vault_index` tout en partageant le multisig**. Excellent pattern pour Tend.

**Confiance section 8 : haut** (design clair à partir du code).

---

## 9. COMPARAISON AVEC LES ALTERNATIVES

| Alternative | Pour | Contre | Verdict pour Tend |
|---|---|---|---|
| **Squads v4 spending_limits** | Audité 3×, formellement vérifié, immutable, 32k comptes live, granularité fine par campagne, AGPL non-bloquant pour consumer | Rent 1.8× custom, période min 1 jour, reset non-rolling, AGPL bloque fork commercial | **Retenu sous conditions §10** |
| **Hot wallet pur côté agent (custody)** | Zero overhead on-chain, latence min, flexibilité totale, pas de setup par campagne | **Aucune contrainte on-chain** : si la clé agent est compromise, tout le budget de toutes les campagnes part. Rugpull interne trivial. Pas racontable aux créateurs qui confient des fonds. | **Rejeté** — incompatible avec la promesse "on-chain programmable growth" de Tend |
| **Jito Merkle distributor** | Battle-tested, distribue à N adresses avec claim | Snapshot-based, pas live. Un utilisateur doit claim lui-même. Incompatible avec "cashback automatique quelques secondes après swap". | **Rejeté** pour le use case cashback live. Possible pour un produit "rewards hebdomadaires" différent. |
| **Jupiter merkle-distributor-sdk** | Idem Jito, bien documenté | Idem : distribution par claim, pas par push. | **Rejeté** même raison. |
| **Anchor program custom + audit externe** | Contrôle total, period custom en secondes, logique métier fine, pas de contrainte AGPL | Coût audit externe 20k–80k USD, 2–4 mois dev + audit, un programme propriétaire peu éprouvé même post-audit. **Le bon audit ne garantit rien à zero-day.** | **Reporté phase 2** — pas maintenant, pas pour un hackathon en cours. Squads sert de rail intermédiaire le temps d'accumuler du volume qui justifie le coût d'un programme custom. |
| **Solana Pay / simple `SystemProgram.transfer` signé par agent** | Simple, rapide, gratuit en rent | **Exactement équivalent au hot wallet pur** en termes de garanties. Aucune limite d'amount on-chain. | **Rejeté** — même problème que hot wallet. |

**Conclusion comparative** : Squads v4 spending_limits est **l'option la plus crédible pour un rail de cashback live qui raconte une histoire de sécurité sérieuse auprès des créateurs**, sans exiger un programme custom qu'on ne peut pas auditer sérieusement dans le calendrier hackathon.

**Confiance section 9 : haut**.

---

## 10. RECOMMANDATION FINALE — GO AVEC CAVEATS

### Recommandation : **GO**

### Caveats à accepter et implémenter explicitement

1. **Période on-chain = jour.** Si Tend veut vendre "X SOL de cashback par heure", c'est l'agent backend qui enforce le rate-limit applicatif, pas Squads. Expliciter cette architecture dans la fiche technique interne.

2. **Reset non-rolling.** Documenter côté produit : "le budget se réinitialise à minuit UTC" (ou autre référentiel basé sur `last_reset` à la création). Ne pas promettre un rolling window.

3. **Blast radius de la clé agent = `amount` de la période.** Configurer `amount` au maximum raisonnable pour une journée de cashback normale, pas à l'ensemble du budget campagne. Rotation régulière de la clé hot-wallet.

4. **Pattern "un multisig, N SpendingLimits via `vault_index`".** Ne pas créer un multisig par campagne — c'est inefficient. Un multisig Tend par créateur (ou par workspace), puis N SpendingLimits enfants avec vault_index distincts. Valider architecturalement avant de coder.

5. **Monitoring on-chain de `ProgramConfig.multisig_creation_fee`.** Ce paramètre peut être relevé unilatéralement par l'authority Squads. Mettre une alerte si la valeur change.

6. **Plan de migration v5 à 12–24 mois.** Pas bloquant immédiat, mais à mettre dans le backlog produit. Tend doit pouvoir relire / écrire sur v5 quand la primitive spending_limit y arrivera.

7. **Conseil juridique sur AGPL avant tout plan commercial B2B.** Fork interdit sans obligation de publier. À clarifier si Tend prévoit un jour d'étendre Squads (période horaire custom, etc.).

8. **Mesurer le coût CU réel d'un `spending_limit_use` SOL en devnet avant prod.** L'estimation 20k–40k CU est raisonnable mais non confirmée sur mainnet au moment de cet audit.

9. **Test d'échelle.** Avant de promettre 10 000 payouts/jour : benchmark réel avec une campagne test sur mainnet à 1000 payouts/jour pendant 7 jours.

### Temps estimé de mise en production
- Intégration SDK `@sqds/multisig` dans `packages/shared` : **1–2 jours**
- Orchestrateur création multisig + spending_limit depuis MCP + API : **2–3 jours**
- Agent signer payout + retry + logging : **2 jours**
- Tests mainnet-beta + garde-fous : **2 jours**
- **Total : ~7–10 jours** pour un rail cashback Squads end-to-end.

C'est dans le budget. On ne perd pas les 3–5 jours qu'on craignait initialement.

---

## Annexe — Sources

- Dépôt : `https://github.com/Squads-Protocol/v4` @ `edbca83` (2026-04-15)
- Program ID mainnet : `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- Audits lus : `audits/neodyme_squads_v4_report_2024_final.pdf`, `audits/ottersec_squads_v4_report_2024_final.pdf`, `audits/certora_squads_v4_security_report_and_formal_verification_2024_final.pdf`
- Vérifications on-chain : RPC `https://api.mainnet-beta.solana.com`, méthodes `getAccountInfo` (ProgramData + ProgramConfig) et `getProgramAccounts` filtré sur discriminators Anchor `Multisig` / `SpendingLimit`, le 2026-04-19
- Code lu en détail : `programs/squads_multisig_program/src/state/spending_limit.rs`, `programs/squads_multisig_program/src/state/multisig.rs`, `programs/squads_multisig_program/src/state/program_config.rs`, `programs/squads_multisig_program/src/instructions/spending_limit_use.rs`, `sdk/multisig/src/transactions/spendingLimitUse.ts`

**Niveau de confiance global sur ce rapport : haut sur la partie technique on-chain, moyen sur les aspects juridiques (AGPL) et sur les coûts CU précis qui demandent une mesure terrain.**
