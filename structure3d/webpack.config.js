module.exports = (env, argv) => ({
  entry: './src/Structure3D.ts',
  output: {
    path: __dirname + '/out',
    filename: 'structure3d.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      { test: /\.ts$/, loader: 'ts-loader' }
    ]
  }
})
