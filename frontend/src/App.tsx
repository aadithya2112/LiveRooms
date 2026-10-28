import { Routes, Route, Link } from 'react-router-dom';
import HomePage from './HomePage';
import Room from './Room';
function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<Room />} />
      <Route
        path="*"
        element={
          <div className="invalid-room">
            <h1>Nothing here, yet.</h1>
            <Link className="button primary" to="/">
              Find your room
            </Link>
          </div>
        }
      />
    </Routes>
  );
}
export default App;
