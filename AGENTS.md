# Wskazówki dla agentów AI

To repo jest **celem wdrożenia**, nie miejscem pracy nad kodem.

- **Nie edytuj plików tutaj.** Źródło: prywatne repo `wojcik-michal/Orszak-Selly-Assist`
  (lokalnie zwykle obok tego repo, np. `../Orszak-Selly-Assist`). Zmiany rób tam i wdrażaj
  skryptem `scripts/deploy-panel.ps1 -Only app` — sam zbuduje i wypchnie pliki do tego repo.
- Wyjątek: ten plik, `CLAUDE.md`, `README.md` i `.nojekyll` są utrzymywane ręcznie;
  skrypt wdrożenia ich nie nadpisuje.
- **Repo jest publiczne.** Nigdy nie commituj tu sekretów, tokenów, ID arkuszy ani danych osobowych
  (także w komunikatach commitów).
- Commity tworzy skrypt wdrożenia w formacie `deploy <sha repo źródłowego>`; historia tego repo
  = historia wdrożeń. Wycofanie = `deploy-panel.ps1 -Rollback` w repo źródłowym.
- Po wdrożeniu podaj link: https://wojcik-michal.github.io/osa-public-site/
