import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
import "./pwa.js";

mount(App, { target: document.getElementById("app")! });
