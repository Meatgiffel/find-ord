import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });
mount(App, { target: document.getElementById("app")! });
