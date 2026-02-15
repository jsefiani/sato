import Grainient from '@/react-bits/Grainient'

export default function MeshGradient() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <Grainient
        color1="#d6e4f7"
        color2="#c8dcf8"
        color3="#d0e0fa"
        saturation={1.3}
        contrast={0.8}
        gamma={1.6}
        grainAmount={0.18}
        timeSpeed={0.15}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
    </div>
  )
}
