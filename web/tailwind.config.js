/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', 'class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: [
  				'var(--font-inter)',
  				'system-ui',
  				'sans-serif'
  			],
  			heading: [
  				'var(--font-sora)',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'var(--font-jetbrains-mono)',
  				'ui-monospace',
  				'SFMono-Regular',
  				'monospace'
  			]
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			profit: 'var(--profit)',
  			loss: 'var(--loss)',
  			noether: {
  				bg: '#0a0a0a',
  				violet: '#8b5cf6',
  				blue: '#3b82f6',
  				cyan: '#06b6d4'
  			},
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			shimmer: {
  				'100%': {
  					transform: 'translateX(100%)'
  				}
  			},
  			pulse: {
  				'0%, 100%': {
  					opacity: '1'
  				},
  				'50%': {
  					opacity: '0.5'
  				}
  			},
  			'blob-morph-1': {
  				'0%':   { borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', transform: 'translate(0, 0) rotate(0deg) scale(1)' },
  				'25%':  { borderRadius: '70% 30% 50% 50% / 30% 30% 70% 70%', transform: 'translate(30px, -40px) rotate(45deg) scale(1.05)' },
  				'50%':  { borderRadius: '50% 60% 30% 70% / 60% 40% 60% 40%', transform: 'translate(-20px, 20px) rotate(90deg) scale(0.95)' },
  				'75%':  { borderRadius: '30% 70% 40% 60% / 50% 60% 30% 70%', transform: 'translate(10px, -10px) rotate(135deg) scale(1.02)' },
  				'100%': { borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', transform: 'translate(0, 0) rotate(180deg) scale(1)' },
  			},
  			'blob-morph-2': {
  				'0%':   { borderRadius: '60% 40% 30% 70% / 50% 60% 40% 50%', transform: 'translate(0, 0) rotate(0deg) scale(1)' },
  				'50%':  { borderRadius: '70% 30% 40% 60% / 60% 50% 30% 70%', transform: 'translate(25px, -15px) rotate(-90deg) scale(0.97)' },
  				'100%': { borderRadius: '60% 40% 30% 70% / 50% 60% 40% 50%', transform: 'translate(0, 0) rotate(-180deg) scale(1)' },
  			},
  			'blob-morph-3': {
  				'0%':   { borderRadius: '50% 50% 40% 60% / 60% 40% 50% 50%', transform: 'translate(0, 0) rotate(0deg)' },
  				'50%':  { borderRadius: '40% 60% 50% 50% / 50% 50% 60% 40%', transform: 'translate(-30px, -10px) rotate(120deg)' },
  				'100%': { borderRadius: '50% 50% 40% 60% / 60% 40% 50% 50%', transform: 'translate(0, 0) rotate(180deg)' },
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			shimmer: 'shimmer 2s infinite',
  			pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  			'blob-1': 'blob-morph-1 18s ease-in-out infinite',
  			'blob-2': 'blob-morph-2 22s ease-in-out infinite',
  			'blob-3': 'blob-morph-3 20s ease-in-out infinite'
  		}
  	}
  },
  plugins: [require('tailwindcss-animate')],
}
