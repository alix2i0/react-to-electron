
---
# ⚡ React + Electron Starter (One-Click Setup)

This project is a **template** that lets you run your **React app inside Electron** with minimal setup.
You can build desktop apps using your existing React project with **one command** 🚀.

---

## 📦 Features

* ✅ React + Electron integration out of the box
* ✅ Hot reload for React frontend
* ✅ Auto Electron reload on changes
* ✅ Build cross-platform desktop apps (Windows, macOS, Linux)
* ✅ Pre-configured `tsconfig` for both React + Electron
* ✅ Single script setup (no manual steps)

---

## 🚀 Getting Started

### 1️⃣ Clone the repo

```sh
git clone https://github.com/alix2i0/react-to-electron.git
cd react-to-electron
```

### 2️⃣ Install dependencies

```sh
npm install
```

### 3️⃣ Run in development

```sh
npm run dev
```

This will:

* Start the React app
* Start Electron
* Auto-open your desktop app

---

## 🏗️ Build for Production

To package your app for distribution:

```sh
npm run build
npm run electron:build
```

This will generate an installer for your OS inside the **`dist/`** folder.

---

---

## ⚙️ Scripts

| Command                  | Description                        |
| ------------------------ | ---------------------------------- |
| `npm run dev`            | Start React + Electron in dev mode |
| `npm run build`          | Build React for production         |
| `npm run electron:build` | Package Electron app for your OS   |
| `npm run electron:tsc`   | Compile Electron TS files          |

---

## 🖥️ Cross Platform Builds

You can build apps for **Windows, macOS, and Linux**.

Example (build Windows app on Windows):

```sh
npm run electron:build
```

If you need cross-compilation (e.g. build macOS on Linux), configure [electron-builder](https://www.electron.build/multi-platform-build).

---

## 🔥 Why this template?

Normally, integrating React + Electron requires **manual setup** of:

* tsconfig for both React & Electron
* Webpack/Vite adjustments
* Electron reload scripts

👉 This template automates everything so you can **focus on building your app**.

---

## 📜 License

MIT License — free to use for personal & commercial apps.

---

✨ Now anyone can fork your repo, run `npm install`, and instantly run React as a desktop app with Electron.

---
