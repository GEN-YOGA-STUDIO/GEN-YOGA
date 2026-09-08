module.exports = {
  content: ["./*.html", "./*.js"],
  theme: {
    extend: {
      colors: {
        cocoa: '#26160C',
        golden: '#9B7B37',
        terracotta: '#E1654E',
        mutedbrown: '#7F5040',
        mutedgold: '#A69C6A',
        beige: '#D3CAB4',
        ivory: '#F8F6F2',
        slate: '#708090',
        sand: '#D3CAB4',
        olive: '#9B7B37'
      },
      spacing: {
        '100': '25rem',
        '120': '30rem',
        '140': '35rem',
        '160': '40rem',
        '180': '45rem',
        '200': '50rem',
      },
      fontFamily: {
        serif: ['Ubuntu', 'sans-serif'],
        sans: ['"Montserrat Arabic"', 'Montserrat', 'sans-serif'],
        ubuntu: ['Ubuntu', 'sans-serif']
      }
    }
  }
}
