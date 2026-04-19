# Squads v4 SpendingLimits — spike report (Phase 0)

**Date**: 2026-04-20
**Network**: Solana devnet
**SDK**: `@sqds/multisig@2.1.4` + `@solana/web3.js`
**Program ID**: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
**Sandbox**: `~/CascadeProjects/squads-spike/` (hors monorepo Tend)

## Objectif
Dé-risquer l'intégration Squads v4 avant Phase 1 : valider que le pattern `multisig 1-of-1 + SpendingLimit` marche end-to-end, mesurer le coût CU réel, et confirmer que l'enforcement du cap est bien on-chain (pas juste client-side).

## Résultat — GO

Tous les assertions passent. Aucun blocker identifié pour Phase 1.

## Ce qui a été validé

### 1. Création multisig 1-of-1 par le créateur
- `multisigCreateV2` avec `configAuthority = creator`, `threshold = 1`, un seul `Member` (creator avec toutes les permissions)
- Devnet : frais de création = `0 lamports` (ProgramConfig.multisigCreationFee). Mainnet : à vérifier (non-zero possible).
- Le créateur signe directement — pas de proposal flow nécessaire.
- PDAs dérivés correctement : `getMultisigPda({createKey})`, `getVaultPda({multisigPda, index: 0})`.

### 2. Attachement SpendingLimit direct (sans proposal)
- `multisigAddSpendingLimit` appelé **directement par `configAuthority`** quand cette dernière est une clé Ed25519 régulière (le créateur). Pas de `ConfigTransaction` ni `Proposal` nécessaire.
- `mint: PublicKey.default` (all-zeros = System Program ID) = convention Squads pour SOL-denominated.
- `period: multisig.generated.Period.Day` = fenêtre rolling 24h (confirmé par test — après 3 utilisations à 0.003 SOL, la 4ᵉ à 0.002 SOL est rejetée = cap glissant bien appliqué).
- `members: [agentPubkey]` : agent est le seul autorisé à appeler `spending_limit_use`.
- `destinations: []` : tableau vide = n'importe quelle destination. Si non-vide, seules les destinations listées sont permises.
- **Gotcha découvert** : pour `multisigAddSpendingLimit`, `createKey` est **uniquement une seed PDA, PAS un signer**. Contrairement à `multisigCreateV2` où `createKey` DOIT signer. Ne pas inclure `spendingLimitCreateKey` dans `Transaction.signers`.

### 3. Enforcement on-chain du cap
- 3 × `spending_limit_use(0.003 SOL)` → succès, destination reçoit 0.009 SOL total
- 4ᵉ × `spending_limit_use(0.002 SOL)` → **rejet on-chain** avec :
  - Error code `0x178a` = `SpendingLimitExceeded` (6026)
  - Rejet au stade **simulation** (preflight), donc **aucuns frais payés par l'agent** sur la tentative rejetée
  - Message AnchorError explicite et parseable : `"Spending limit exceeded."`
- ⇒ Confirme que le cap est vraiment on-chain, pas côté client. Une clé agent volée ne peut pas dépenser au-delà.

### 4. Coût CU mesuré
- `spending_limit_use` réussi : **15,360 CU** par appel
- `spending_limit_use` rejeté : 13,796 CU consommés avant rejet (non facturés en preflight)
- Budget CU par défaut = 200,000 — on consomme < 8%. Aucun besoin de `ComputeBudgetProgram.setComputeUnitLimit`.
- Coût fee agent ≈ 5000 lamports (base fee Solana) par payout réussi. Négligeable.

### 5. Trust model validé
- Le créateur garde le contrôle :
  - `configAuthority` = creator → peut révoquer/modifier la SpendingLimit à tout moment via `multisigRemoveSpendingLimit`
  - `vault` est un PDA du multisig dont le créateur est l'unique Member avec threshold 1 → peut retirer tous les fonds via `vault_transaction` flow quand il veut
- L'agent Tend ne peut PAS :
  - Changer le cap
  - Ajouter une nouvelle SpendingLimit
  - Retirer des fonds hors du scope SpendingLimit
  - Transférer l'ownership du multisig
- Le blast radius d'une clé agent volée est **borné on-chain à `amount` par période** — confirmé par le test adversarial ci-dessus.

## Artefacts on-chain (devnet, pour reproduction/verification)

| Rôle | Adresse |
|---|---|
| Creator (payer + configAuthority) | `J8LKTXk548J7PpVEy7bt47wCCYUFVoTPXsZziP3Dtk6p` |
| Agent (SpendingLimit member) | `HnYFU35sUdU1y3nBSDcjgPbvm6rK92HymcLNAd4dQyjS` |
| Destination (test trader) | `7g8LGJrhw4qDukiF9ZukiRVx5g47D4eJpiFAgioAucsF` |
| Multisig PDA | `7UQ3yo1JaLq3EwhVL8u1k8Y3YgUP6TkGLAfJ1eA9Kc3B` |
| Vault PDA (index 0) | `FSgzGmPYRBssLhkS6DWKzBBfUw5mDY2hh2e4hSnccoHD` |
| SpendingLimit PDA | `3c5Mqx2BtMabDeBUBLhHG9ecRdXPmVJrAuXYm5BJk2oW` |

### Transactions (devnet, Solscan-inspectables)
- Multisig create : `5vebbnm9fTYJfakKAC43detcNFreGM9tw2wms4Dt8hv3Fu6hX8wJcq9MJSudQdLMdPmEn49joP1xGEYsgZRgYAum`
- Vault fund (0.05 SOL) : `5JtM3cVUzuKfJQXQMrSAZdJGwgUkRuH1gxJfqZfGErnDfDxr9e3xibnWwVKa3rJMPtrjSn7MZ8BE1bFNGkVXJp1W`
- SpendingLimit attach (amount=0.01 SOL, period=Day, member=agent) : `2kwqbph1EqH5haXKF2FypLGMxyrARBAM7kx9NtH9Tm4sWMB2fPzcmNpLhPB3SPckq68puV8ErUCDK9xosrKsBcJB`
- Payout 1 (0.003 SOL) : `5cJRVkg7cfbq3RSafbEf6vofy4Nutgva1EyZKzk2KbPtHvRbomCyyMLvehC3nRuPNJ8wieb3A7AuyNV6kCHHWVi3`
- Payout 2 (0.003 SOL) : `2YvYgbUjmQkReDa9VD2m4jskHVzpna5v8wcYaeTvKLMowLNqVJcJHkaVxzVMrmiwuLYt3qE4PvjTG1waf4xkDD8Q`
- Payout 3 (0.003 SOL) : `3Gxp8vEM1ZRBbE4wiuzVuBa3jh81b5gakVHMFB7aMaZ4QE13TmSctMEfc1ZkQn5eexbAxih7EifdyUGjCxWo7Fyu`
- Payout 4 (0.002 SOL) : **rejected — `SpendingLimitExceeded (6026)`**

## Enseignements pour Phase 1 (intégration monorepo)

### Points techniques à tenir
1. **Deux `createKey` différents à générer par campagne** : un pour la PDA multisig (qui sera signer à la création), un pour la PDA SpendingLimit (qui n'est PAS signer à l'attach). Les stocker dans `campaigns.squads_multisig_create_key` et `campaigns.squads_spending_limit_create_key` (serialized base58 ou hex).
2. **Ordre des signers** dans les tx :
   - `multisigCreateV2` : `[creator, multisigCreateKey]`
   - `multisigAddSpendingLimit` : `[creator]` seul
   - `spendingLimitUse` : `[agent]` seul
   - `vault` funding : `[creator]` (simple System transfer)
3. **Parsing des erreurs** : toutes les erreurs Squads sont des AnchorError avec numéro stable. `SpendingLimitExceeded = 6026` doit être traitée comme **cap atteint, réessayer dans la prochaine période** (pas comme erreur fatale). Autres à matrixer pendant Phase 1.
4. **Agent funding operationnel** : la clé agent a besoin d'une réserve de SOL pour les frais de tx (≈5000 lamports par payout). Un mécanisme de top-up automatique est nécessaire en prod — décision : fonder depuis la treasury Tend (pas depuis les vaults créateurs) via un batch réplénissement quotidien.

### Décisions à verrouiller avant Phase 1
Les 4 défauts que j'ai validés avec toi tiennent toujours après le spike :
1. ✅ **Pattern multisig** : 1 multisig par créateur + N SpendingLimits via `vault_index` différent — confirmé faisable (vaultPda dépend de `index`, PDAs distincts)
2. ✅ **Config authority** : créateur seul — confirmé, pas de friction proposal-flow
3. ✅ **Agent key storage** : env var Render au MVP — le pattern Ed25519 standard marche
4. ✅ **Formule `amount` par défaut** : `min(pool_cap × 30%, 0.5 SOL)` par période — à implémenter en Phase 1

### Points ouverts à traiter en Phase 1 (non-bloquants pour spike)
- **Period choice** : `Day` vs `OneTime` vs custom. `Day` = rolling 24h depuis premier use, `OneTime` = une seule utilisation cumulative. Pour cashback continu → `Day` retenu. Pour des campagnes bornées dans le temps → à réévaluer (peut-être exposer un choix créateur).
- **Mainnet `multisigCreationFee`** : devnet = 0. Mainnet possiblement non-zero (à lire depuis ProgramConfig au déploiement, ne pas hardcoder).
- **Rent costs réels en mainnet** : sur devnet, rent lamports assigné au multisig est identique (deterministic). À chiffrer en USD à la création de la première campagne mainnet.
- **Empty destinations list** : un SpendingLimit avec `destinations: []` permet n'importe quelle destination. Si on veut restreindre le cashback aux seuls traders détectés comme légitimes par le fraud gate, il faudrait soit rebuild la SpendingLimit régulièrement (coûteux), soit garder `destinations: []` et assumer que le fraud gate filtre off-chain. **Décision retenue** : garder `[]` et compter sur le fraud gate + bounded amount. Le bounded amount on-chain reste la garantie forte.

## Next step
Phase 1 — client wrappers `@tend/shared/squads-client.ts` :
- `createCampaignMultisig(creator, campaignId)` → `{multisigPda, vaultPda, createKeyHex}`
- `attachSpendingLimit(creator, multisig, {agent, amountLamports, period, vaultIndex})` → `{spendingLimitPda, createKeyHex}`
- `executePayout(agent, {multisigPda, spendingLimitPda, destination, amount, vaultIndex})` → `{sig}`
- `removeSpendingLimit(creator, multisig, spendingLimitPda)` → `{sig}`
- `fundVault(payer, vaultPda, amount)` → `{sig}`
- Types Drizzle pour persister les PDAs par campagne.
- Tests LiteSVM pour chaque wrapper.

Estimation : 2-3 jours.
