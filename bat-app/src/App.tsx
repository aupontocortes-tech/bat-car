import { useState } from 'react';
import HomeScreen from './features/home/HomeScreen';
import CameraScreen from './features/camera/CameraScreen';

function App() {
  const [mode, setMode] = useState<'home' | 'camera'>('home');
  return mode === 'home' ? (
    <HomeScreen onStart={() => setMode('camera')} />
  ) : (
    <CameraScreen onBack={() => setMode('home')} />
  );
}

export default App;
