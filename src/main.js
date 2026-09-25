/** Load application settings, the user template, and the generated registry independently. */
class ApplicationData {
    static async read_json(path) {
        const response = await fetch(new URL(path, document.baseURI), {
            cache: 'no-cache'
        });
        if (!response.ok) {
            throw new Error(`Unable to load ${path} (${response.status}).`);
        }
        return response.json();
    }

    static async load() {
        if (typeof OFFLINE_DATA !== 'undefined') {
            return OFFLINE_DATA;
        }
        const config = await this.read_json('./config.json');
        const [items, metadata, template, legacy] = await Promise.all([this.read_json(config.catalog_path), this.read_json(config.catalog_metadata_path), this.read_json(config.template_path), this.read_json(config.legacy_preset_path)]);
        return {
            config,
            items,
            metadata,
            template,
            legacy
        };
    }
}
ApplicationData.load().then(async options => {
    const application = new PlannerApplication(options);
    await application.initialize();
}).catch(error => {
    const message = document.getElementById('error');
    message.textContent = 'Unable to open the planner. ' + error.message;
    message.hidden = false;
    document.getElementById('saveStatus').textContent = 'Load failed';
});
