const express = require('express');
const path = require('path');

const app = express();
const PORT = 8081

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html']
}));

app.get('/api/info', (req, res) => {
  res.json({
    status: 'success',
    message: 'Connected'
  });
});

app.use((req, res) => {
  res.status(404).send('<h1>404 - Page not found</h1>');
});

app.listen(PORT, () => {
  console.log(`Server is running at http://<all-interfaces>:${PORT}`);
}); 
