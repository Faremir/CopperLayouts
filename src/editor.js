/** Edit chest and floor drafts; commit changes only after Save. */
class LayoutEditor {
    constructor(app) {
        this.app = app;
        this.chest_draft = null;
        this.chest_target = null;
        this.chest_is_new = false;
        this.floor_draft = null;
        this.floor_is_new = false;
        this.catalog_entries = this.app.catalog.entries;
    }

    open_chest_editor(id = null, target = null) {
        const c = id ? this.app.indexes.chests.get(id) : null;
        if (id && !c) {
            return;
        }
        this.app.picked = null;
        this.app.mark_selection();
        this.app.render_inspector();
        this.chest_draft = c ? structuredClone(c) : {
            id: 'chest-' + crypto.randomUUID(),
            label: 'New chest',
            family: '',
            role: '',
            items: [],
            sourceSlot: '',
            sourceGroup: ''
        };
        this.chest_target = target;
        this.chest_is_new = !c;
        get_element('chestEditorHeading').textContent = c ? 'Edit chest' : 'Create chest';
        get_element('chestName').value = this.chest_draft.label;
        get_element('saveChest').textContent = c ? 'Save chest' : 'Create chest';
        get_element('catalogSearch').value = '';
        get_element('chestEditError').hidden = true;
        this.render_draft_items();
        this.render_catalog();
        get_element('chestEditor').showModal();
        get_element('chestName').focus();
        if (!c) {
            get_element('chestName').select();
        }
    }

    render_draft_items() {
        get_element('draftItemCount').textContent = this.chest_draft.items.length;
        get_element('draftItems').innerHTML = this.chest_draft.items.length ? this.chest_draft.items.map((item, i) => `<div class="draft-item">
<div class="draft-item-field">
<input data-item-name="${i}" aria-label="Item name ${i + 1}" value="${escape_html(item.name)}" required maxlength="500" autocomplete="off" disabled="disabled>
<small>${escape_html(item.itemId || 'Custom item')}</small>
</div>
<button type="button" class="quiet remove-item" data-remove-item="${i}" aria-label="Remove ${escape_html(item.name)}">✕</button>
</div>`).join('') : '<p class="empty-detail">No items yet.</p>';
    }

    catalog_matches(query) {
        return this.app.catalog.search(query);
    }

    render_catalog() {
        const query = get_element('catalogSearch').value.trim(),
            results = get_element('catalogResults');
        const matches = this.catalog_matches(query);
        results.hidden = !query;
        results.innerHTML = query ? matches.slice(0, 20).map(item => `<button type="button" data-add-item="${escape_html(item.itemId)}">
<span>${escape_html(item.name)}</span>
<small>${escape_html(item.itemId)}</small>
<span aria-hidden="true">＋</span>
</button>`).join('') + `<button type="button" class="custom-item" data-custom-item="true">
<span>Add custom: ${escape_html(query)}</span>
<span aria-hidden="true">＋</span>
</button>` : '';
    }

    add_draft_item(item) {
        this.chest_draft.items.push({
            name: item.name,
            itemId: item.itemId || ''
        });
        this.render_draft_items();
        get_element('draftItems').lastElementChild?.scrollIntoView({
            block: 'nearest'
        });
        get_element('catalogSearch').focus({
            preventScroll: true
        });
    }

    open_floor_editor(id = null) {
        const f = id === null ? null : this.app.indexes.floors.get(id);
        if (id !== null && !f) {
            return;
        }
        this.floor_is_new = !f;
        this.floor_draft = f ? structuredClone(f) : {
            id: Math.max(-1, ...this.app.layout.floors.map(f => f.id)) + 1,
            name: 'New floor',
            shortName: 'New floor',
            walls: ['T', 'R', 'B', 'L'].filter(wall => this.app.config.default_module_counts[wall] > 0),
            moduleCounts: structuredClone(this.app.config.default_module_counts)
        };
        get_element('floorEditorHeading').textContent = f ? 'Edit floor' : 'Create floor';
        get_element('floorTitle').value = this.floor_draft.name;
        for (const input of get_element('floorForm').querySelectorAll('[data-wall-count]')) {
            input.value = this.floor_draft.moduleCounts[input.dataset.wallCount];
        }
        get_element('deleteFloor').hidden = !f;
        get_element('floorEditError').hidden = true;
        get_element('floorEditor').showModal();
        get_element('floorTitle').focus();
        if (!f) {
            get_element('floorTitle').select();
        }
    }

    bind_events() {
        get_element('newFloor').addEventListener('click', () => this.open_floor_editor());
        get_element('editFloor').addEventListener('click', () => this.open_floor_editor(this.app.floor));
        get_element('clearLayout').addEventListener('click', () => get_element('clearEditor').showModal());
        get_element('confirmClear').addEventListener('click', () => {
            get_element('clearEditor').close();
            this.app.clear_drag();
            this.app.close_search(true);
            this.app.commit(Layout.clear(this.app.layout), 'Layout cleared · Undo to restore');
        });
        get_element('catalogSearch').addEventListener('input', event => this.render_catalog(event));
        get_element('catalogSearch').addEventListener('keydown', event => {
            if (event.key === 'Enter' && get_element('catalogSearch').value.trim()) {
                event.preventDefault();
                const first = this.catalog_matches(get_element('catalogSearch').value)[0];
                this.add_draft_item(first || {
                    name: get_element('catalogSearch').value.trim(),
                    itemId: ''
                });
            }
        });
        get_element('draftItems').addEventListener('input', event => {
            if (event.target.dataset.itemName !== undefined) {
                this.chest_draft.items[Number(event.target.dataset.itemName)].name = event.target.value;
            }
        });
        document.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) {
                return;
            }
            if (button.id === 'newChest') {
                this.open_chest_editor();
                return;
            }
            if (button.dataset.close) {
                get_element(button.dataset.close).close();
                return;
            }
            if (button.dataset.removeItem !== undefined) {
                this.chest_draft.items.splice(Number(button.dataset.removeItem), 1);
                this.render_draft_items();
                return;
            }
            if (button.dataset.addItem) {
                const item = this.catalog_entries.find(i => i.itemId === button.dataset.addItem);
                if (item) {
                    this.add_draft_item(item);
                }
                return;
            }
            if (button.dataset.customItem) {
                this.add_draft_item({
                    name: get_element('catalogSearch').value.trim(),
                    itemId: ''
                });
            }
        });
        get_element('chestForm').addEventListener('submit', event => {
            event.preventDefault();
            try {
                const old = this.app.indexes.chests.get(this.chest_draft.id);
                const changed = old && JSON.stringify(old.items) !== JSON.stringify(this.chest_draft.items);
                const next_chest = {
                    ...this.chest_draft,
                    label: get_element('chestName').value.trim(),
                    items: this.chest_draft.items.map(i => ({
                        ...i,
                        name: i.name.trim()
                    })),
                    family: changed ? '' : this.chest_draft.family,
                    role: changed ? '' : this.chest_draft.role
                };
                const next = Layout.saveChest(this.app.layout, next_chest, this.chest_is_new ? this.chest_target : null);
                this.app.selected = next_chest.id;
                get_element('chestEditor').close();
                this.app.commit(next, this.chest_is_new ? 'Chest created' : 'Chest updated');
            } catch (error) {
                get_element('chestEditError').textContent = error.message;
                get_element('chestEditError').hidden = false;
            }
        });
        get_element('floorForm').addEventListener('submit', event => {
            event.preventDefault();
            try {
                const name = get_element('floorTitle').value.trim();
                const module_counts = Object.fromEntries([...get_element('floorForm').querySelectorAll('[data-wall-count]')].map(i => [i.dataset.wallCount, i.valueAsNumber]));
                if (Object.values(module_counts).some(n => !Number.isSafeInteger(n) || n < 0 || n > Layout.MAX_MODULES_PER_WALL)) {
                    throw new Error(`Use a whole number from 0 to ${Layout.MAX_MODULES_PER_WALL.toLocaleString()} for each wall.`);
                }
                const walls = ['T', 'R', 'B', 'L'].filter(w => module_counts[w] > 0);
                const next = Layout.saveFloor(this.app.layout, {
                    ...this.floor_draft,
                    name,
                    shortName: name,
                    walls,
                    moduleCounts: module_counts
                });
                const staged = next.staging.length - this.app.layout.staging.length;
                this.app.floor = this.floor_draft.id;
                get_element('floorEditor').close();
                this.app.commit(next, staged ? `${staged} chests moved to staging` : this.floor_is_new ? 'Floor created' : 'Floor updated');
            } catch (error) {
                get_element('floorEditError').textContent = error.message;
                get_element('floorEditError').hidden = false;
            }
        });
        get_element('deleteFloor').addEventListener('click', () => {
            const next = Layout.deleteFloor(this.app.layout, this.floor_draft.id);
            get_element('floorEditor').close();
            this.app.commit(next, 'Floor removed · its chests are in staging');
        });
    }
}
