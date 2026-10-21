import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import App from './App';
import { selectAirportFromUrl } from './data/registry';

selectAirportFromUrl();

// No StrictMode: the scope owns imperative WebGL/Mapbox resources (and Mapbox map loads are metered).
document.fonts.load('11px "JetBrains Mono"').finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
