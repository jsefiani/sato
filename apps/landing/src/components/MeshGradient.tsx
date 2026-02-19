import Grainient from '@/react-bits/Grainient'

export default function MeshGradient({
  color1 = '#eaf1fb',
  color2 = '#e3edfc',
  color3 = '#edf4fe',
}: {
  color1?: string
  color2?: string
  color3?: string
}) {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <Grainient
        color1={color1}
        color2={color2}
        color3={color3}
        saturation={1.1}
        contrast={0.8}
        gamma={1.6}
        grainAmount={0.18}
        timeSpeed={0.15}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
    </div>
  )
}
