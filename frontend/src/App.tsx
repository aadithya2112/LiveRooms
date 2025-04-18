import { Routes, Route } from "react-router-dom";
import HomePage from "./HomePage";
import Room from "./Room";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* The :roomId makes it a dynamic parameter */}
      <Route path="/room/:roomId" element={<Room />} />
    </Routes>
  );
}

export default App;
