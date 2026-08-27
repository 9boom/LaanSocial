const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 80;
const UNIVERSITY_LOGOS_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'universities_logos');
const USER_PROFILE_IMAGES_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'users_profile_image');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);

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

app.get('/api/universities', async (req, res) => {
  try {
    const files = await fs.promises.readdir(UNIVERSITY_LOGOS_DIR, { withFileTypes: true });
    const universities = files
      .filter(file => file.isFile() && IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
      .map(file => {
        const ext = path.extname(file.name);
        const baseName = path.basename(file.name, ext);
        const orderMatch = baseName.match(/^(\d+)\./);
        const cleanName = baseName.replace(/^\d+\./, '');
        const shortNameMatch = cleanName.match(/_(.+)$/);
        const name = cleanName.replace(/_.+$/, '');
        const shortName = shortNameMatch ? shortNameMatch[1] : '';

        return {
          id: baseName,
          order: orderMatch ? Number(orderMatch[1]) : Number.MAX_SAFE_INTEGER,
          name,
          shortName,
          displayName: shortName ? `${name} [${shortName}]` : name,
          image: `assets/sim_db/universities_logos/${encodeURIComponent(file.name)}`
        };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'th'))
      .map(({ order, ...university }) => university);

    res.json(universities);
  } catch (error) {
    console.error('Unable to read university logos:', error);
    res.status(500).json({ error: 'Unable to load universities' });
  }
});

app.get('/api/profile-images', async (req, res) => {
  try {
    const files = await fs.promises.readdir(USER_PROFILE_IMAGES_DIR, { withFileTypes: true });
    const profileImages = files
      .filter(file => file.isFile() && IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
      .map(file => {
        const ext = path.extname(file.name);
        const baseName = path.basename(file.name, ext);
        const displayName = baseName.replace(/[-_]+/g, ' ').trim();

        return {
          id: baseName,
          fileName: file.name,
          name: displayName || baseName,
          src: `assets/sim_db/users_profile_image/${encodeURIComponent(file.name)}`
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));

    res.json(profileImages);
  } catch (error) {
    console.error('Unable to read profile images:', error);
    res.status(500).json({ error: 'Unable to load profile images' });
  }
});

app.use((req, res) => {
  res.status(404).send('<h1>404 - Page not found</h1>');
});

app.listen(PORT, () => {
  console.log(`Server is running at http://<all-interfaces>:${PORT}`);
}); 
