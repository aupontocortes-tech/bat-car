"use client";
import { useRouter } from 'next/navigation';
import CameraScreen from '../../features/camera/CameraScreen';

export default function CameraPage() {
  const router = useRouter();
  return <CameraScreen onBack={() => router.push('/')} />;
}