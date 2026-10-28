import { Link } from 'react-router-dom';
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link className={`brand ${light ? 'brand-light' : ''}`} to="/" aria-label="LiveRooms home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      LiveRooms<span className="brand-period">.</span>
    </Link>
  );
}
