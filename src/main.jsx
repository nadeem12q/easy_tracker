import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ReminderCenter from "./ReminderCenter.jsx";
import SecurityMount from "./SecurityMount.jsx";
import "../styles.css";

ReactDOM.createRoot(document.getElementById("app")).render(
  <React.StrictMode>
    <App />
    <ReminderCenter />
    <SecurityMount />
  </React.StrictMode>
);
