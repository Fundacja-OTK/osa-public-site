# osa-public-site

Opublikowana wersja **panelu OSA** (Orszak Selly Assist), czyli nowego frontendu do panelu sklepu Selly:
raport licencji, orszaki wg województw, ewidencja magazynowa.

**Strona:** [Fundacja-OTK/Orszak-Selly-Assist](https://fundacja-otk.github.io/osa-public-site/))

## Tego repo nie edytuje się ręcznie

Zawartość jest **generowana automatycznie** z kodu źródłowego w prywatnym repo
[Fundacja-OTK/Orszak-Selly-Assist](https://fundacja-otk.github.io/osa-public-site/)).
Każda ręczna zmiana zostanie nadpisana przy następnym wdrożeniu — poprawki rób w repo źródłowym.

| | |
|---|---|
| Kod źródłowy | `Orszak-Selly-Assist` → folder aplikacji panelu |
| Wdrożenie ręczne | `scripts/deploy-panel.ps1 -Only app` w repo źródłowym (testy → build → push tutaj) |
| Wdrożenie automatyczne | GitHub Action w repo źródłowym, klucz `SITE_DEPLOY_KEY` (deploy key tego repo z prawem zapisu) |
| Wersja na stronie | stopka panelu: commit SHA repo źródłowego i data wdrożenia |
| Wycofanie | `scripts/deploy-panel.ps1 -Rollback` albo `git revert` ostatniego commitu tutaj |

## Bezpieczeństwo

Repo i strona są **publiczne**. Trafia tu wyłącznie kod frontendu — bez sekretów, kluczy API,
ID arkuszy i danych klientów. Dane panel pobiera dopiero po zalogowaniu kontem Google,
z backendu (Google Apps Script), który sprawdza whitelistę.
