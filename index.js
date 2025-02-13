import { AppRegistry } from "react-native";
import App from "./App";
import appConfig from "./app.json";

const appName = appConfig?.expo?.name || "translator-app"; // ✅ Prevents undefined name

console.log("📄 Loaded app.json:", JSON.stringify(appConfig, null, 2));
console.log("🚀 Registering App with name:", appName);

if (!appName) {
  console.error("❌ ERROR: App name is undefined! Check app.json.");
} else {
  console.log("✅ App Name:", appName);
}

if (!App) {
  console.error("❌ ERROR: App component is undefined!");
} else {
  console.log("✅ App Component is defined!");
}

// Force re-registration
AppRegistry.registerComponent("main", () => App);

console.log("✅ App Registered Successfully!");
