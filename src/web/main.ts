import { mount } from "svelte";
import App from "./App.svelte";
// Self-hosted Latin subsets (Æ, Ø and Å included), so the installed app has its fonts offline.
import "@fontsource/atkinson-hyperlegible-next/latin-400.css";
import "@fontsource/atkinson-hyperlegible-next/latin-600.css";
import "@fontsource/atkinson-hyperlegible-next/latin-700.css";
import "@fontsource/atkinson-hyperlegible-mono/latin-400.css";
import "@fontsource/atkinson-hyperlegible-mono/latin-700.css";
import "@fontsource/bricolage-grotesque/latin-700.css";
import "@fontsource/bricolage-grotesque/latin-800.css";
import "./style.css";
import "./pwa.js";

mount(App, { target: document.getElementById("app")! });
