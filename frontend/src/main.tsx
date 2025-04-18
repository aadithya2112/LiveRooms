import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css"; // Assuming you have Tailwind or other CSS setup
import { BrowserRouter } from "react-router-dom";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
