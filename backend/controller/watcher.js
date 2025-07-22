const Website = require("../models/Website");

class WatcherController {
    static async watch(req, res) {
        const { url, websiteId } = req.body;
        const websites = await Website.find();

        console.log('Watching websites:', websites.map(w => w.url));


        if (!url || !websiteId) {
            return res.status(400).json({ error: 'URL and Website ID are required' });
        }

        try {
            const result = await ExperimentWatcher.checkExperimentsForUrl(url);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}