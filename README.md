# Таймер ET-66

Обратный отсчёт с подходами, звуками и оставшимся временем в названии вкладки и иконке (favicon).

## Запуск

```bash
npm install
npm run dev
```

## Публикация на GitHub Pages

Сборка — один самодостаточный `dist/index.html` (без внешних путей), поэтому работает в любом подкаталоге.

1. Залейте проект в репозиторий на GitHub (ветка `main`).
2. `Settings → Pages → Build and deployment → Source: GitHub Actions`.
3. После пуша сайт соберётся автоматически (`.github/workflows/deploy.yml`).

Либо вручную: `npm run build` и выложите `dist/index.html`.

## Горячие клавиши

`Пробел` — старт/пауза · `R` — сброс · `M` — звук · `S` — +1 подход
