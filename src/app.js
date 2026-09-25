/** Own the current layout, navigation, history, and chest movement. */
class PlannerApplication {
    constructor(options) {
        this.config = options.config;
        this.catalog = new ItemCatalog(options.items);
        this.initial_layout = Layout.validate(this.catalog.hydrate_template(options.template));
        this.legacy_preset = options.legacy;
        this.catalog_metadata = options.metadata;
        this.storage_key = this.config.storage_key;
        this.legacy_storage_keys = this.config.legacy_storage_keys;
        this.layout = Layout.validate(this.initial_layout);
        this.floor = 0;
        this.selected = 'chest-F0L3-U3';
        this.indexes = undefined;
        this.picked = null;
        this.dragged = null;
        this.dragged_floor = null;
        this.drop_highlight = null;
        this.ignore_click_until = 0;
        this.notice_timer = undefined;
        this.undo_stack = [];
        this.redo_stack = [];
        this.wall_scrolls = new Map();
        this.startup_error = '';
        this.migrated_cache = false;
    }

    async initialize() {
        await this._restore_saved_layout();
        this.editor = new LayoutEditor(this);
        this.render();
        this._bind_events();
        this.editor.bind_events();
        get_element('catalogVersion').textContent = 'Java ' + this.catalog_metadata.minecraft_version;
        if (this.startup_error) {
            this.show_error(this.startup_error);
        } else if (this.migrated_cache) {
            this.save();
        }
    }

    async _restore_saved_layout() {
        try {
            const cached = localStorage.getItem(this.storage_key) || this.legacy_storage_keys.map(key => localStorage.getItem(key)).find(Boolean);
            if (cached) {
                const parsed = JSON.parse(cached);
                this.layout = this.read_layout(parsed);
                this.migrated_cache = parsed.schemaVersion < 4;
                if (this.layout.floors.some(f => f.id === parsed.view?.floor)) {
                    this.floor = parsed.view.floor;
                }
                if (this.layout.chests.some(c => c.id === parsed.view?.selected)) {
                    this.selected = parsed.view.selected;
                }
            }
        } catch (error) {
            this.startup_error = 'The saved layout could not be opened. You can import an exported layout.';
        }
        this.indexes = Layout.index(this.layout);
        if (!this.indexes.chests.has(this.selected)) {
            this.selected = this.layout.chests[0]?.id ?? null;
        }
        if (!this.indexes.floors.has(this.floor)) {
            this.floor = this.layout.floors[0]?.id ?? null;
        }
        if (this.layout !== this.initial_layout) {
            const comparison = {
                ...this.layout
            };
            delete comparison.revision;
            delete comparison.sourceRevision;
            const bytes = new TextEncoder().encode(JSON.stringify(comparison));
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            if (this.config.template_upgrade_hashes.includes(hash)) {
                this.layout = this.initial_layout;
                this.migrated_cache = true;
                this.indexes = Layout.index(this.layout);
                if (!this.indexes.chests.has(this.selected)) {
                    this.selected = this.layout.chests[0]?.id ?? null;
                }
            }
        }
    }

    read_layout(raw) {
        if (raw.chests?.some(chest => chest.items?.some(item => typeof item === 'string'))) {
            raw = this.catalog.hydrate_template(raw);
        }
        const validated = Layout.validate(raw);
        return raw.schemaVersion < 4 ? Layout.validate(this.catalog.repair_preset(validated, this.legacy_preset)) : validated;
    }

    notify(message) {
        clearTimeout(this.notice_timer);
        get_element('notice').textContent = message;
        get_element('notice').classList.add('visible');
        this.notice_timer = setTimeout(() => get_element('notice').classList.remove('visible'), 2500);
    }

    show_error(message) {
        get_element('error').textContent = message;
        get_element('error').hidden = !message;
    }

    save() {
        try {
            localStorage.setItem(this.storage_key, JSON.stringify({
                ...this.layout,
                view: {
                    floor: this.floor,
                    selected: this.selected
                }
            }));
            get_element('saveStatus').textContent = 'Saved';
            get_element('saveStatus').classList.remove('unsaved');
            return true;
        } catch (error) {
            get_element('saveStatus').textContent = 'Export to save';
            get_element('saveStatus').classList.add('unsaved');
            this.show_error('This browser cannot save these changes locally. Use Export to keep your layout.');
            return false;
        }
    }

    commit(next, message) {
        if (next === this.layout) {
            return false;
        }
        this.undo_stack.push(this.layout);
        if (this.undo_stack.length > this.config.history_limit) {
            this.undo_stack.shift();
        }
        this.redo_stack = [];
        this.layout = next;
        this.indexes = Layout.index(this.layout);
        if (!this.indexes.floors.has(this.floor)) {
            this.floor = this.layout.floors[0]?.id ?? null;
        }
        if (!this.indexes.chests.has(this.selected)) {
            this.selected = this.layout.chests[0]?.id ?? null;
        }
        this.picked = null;
        this.render();
        this.save();
        if (message) {
            this.notify(message);
        }
        return true;
    }

    undo() {
        if (!this.undo_stack.length) {
            return;
        }
        this.redo_stack.push(this.layout);
        this.layout = this.undo_stack.pop();
        this.restore_history('Undone');
    }

    redo() {
        if (!this.redo_stack.length) {
            return;
        }
        this.undo_stack.push(this.layout);
        this.layout = this.redo_stack.pop();
        this.restore_history('Redone');
    }

    restore_history(message) {
        this.indexes = Layout.index(this.layout);
        if (!this.indexes.floors.has(this.floor)) {
            this.floor = this.layout.floors[0]?.id ?? null;
        }
        if (!this.indexes.chests.has(this.selected)) {
            this.selected = this.layout.chests[0]?.id ?? null;
        }
        this.picked = null;
        this.render();
        this.save();
        this.notify(message);
    }

    move_chest(id, target) {
        const c = this.indexes.chests.get(id);
        if (!c) {
            return;
        }
        const occupant = target ? this.layout.placements[target] : null;
        this.selected = id;
        const message = target === null ? 'Chest moved to staging' : occupant && occupant !== id ? 'Chests swapped' : 'Chest moved';
        try {
            if (!this.commit(Layout.move(this.layout, id, target), message)) {
                this.picked = null;
                this.render();
            }
        } catch (error) {
            this.show_error(error.message);
        }
    }

    chest_color(c) {
        const woods = [['dark oak', '#947960'], ['pale oak', '#dad4b4'], ['oak', '#bb9a64'], ['spruce', '#9b7c54'], ['birch', '#d5ceac'], ['jungle', '#b99370'], ['acacia', '#c28968'], ['mangrove', '#b9756e'], ['cherry', '#dbafb3'], ['poplar', '#c5b876'], ['crimson', '#bb718e'], ['warped', '#69afa3'], ['bamboo', '#b8be6f']];
        const family = c.family.toLowerCase();
        for (const [name, color] of woods) {
            if (family === name || family.startsWith(name + ' ') || family.startsWith(name + ' ·')) {
                return color;
            }
        }
        const colors = {
            'light gray': '#b9bbb4',
            'light blue': '#86b9d3',
            white: '#d9dad0',
            orange: '#cc9763',
            magenta: '#bc7fbd',
            yellow: '#cfbd6a',
            lime: '#9eb667',
            pink: '#d4a0af',
            gray: '#858d91',
            cyan: '#6baaaa',
            purple: '#9f82b8',
            blue: '#7e94bd',
            brown: '#a08972',
            green: '#8caa7b',
            red: '#be7d73',
            black: '#748181'
        };
        for (const [name, color] of Object.entries(colors)) {
            if (normalize(c.label).startsWith(name + ' ')) {
                return color;
            }
        }
        return '#8aab96';
    }

    tile(chest_id, slot_id = null) {
        const pos = slot_id ? slot_id.split('-').at(-1) : 'Staged';
        if (!chest_id) {
            return `<button type="button" id="slot-${slot_id}" class="chest empty" data-slot="${slot_id}" title="${slot_id} · empty" aria-label="${slot_id}, empty slot">
<span class="tile-meta">${pos}</span>
<span class="plus" aria-hidden="true">+</span>
</button>`;
        }
        const c = this.indexes.chests.get(chest_id);
        const label = `${slot_id || 'Staging'}: ${c.label}`;
        const contents = c.items.map(i => i.name).join(', ');
        const count = c.items.length > 1 ? `<span class="tile-count" title="${c.items.length} item types">+${c.items.length - 1}</span>` : '';
        return `<button type="button" ${slot_id ? `id="slot-${slot_id}" data-slot="${slot_id}"` : ''} class="chest ${chest_id === this.selected ? 'selected' : ''} ${chest_id === this.picked ? 'picked' : ''}" data-chest="${escape_html(chest_id)}" draggable="true" style="--chest-color:${this.chest_color(c)}" title="${escape_html(label + '\n' + contents)}" aria-label="${escape_html(label)}" aria-pressed="${chest_id === this.selected}">
<span class="tile-meta">
<span>${pos}</span>${count}</span>
<span class="tile-label">${escape_html(c.label)}</span>
</button>`;
    }

    render_floors() {
        get_element('floors').innerHTML = this.layout.floors.map(f => `<button type="button" data-floor="${f.id}" draggable="true" class="${f.id === this.floor ? 'active' : ''}" aria-current="${f.id === this.floor ? 'page' : 'false'}" title="${escape_html(f.name)} · Drag to reorder, or Alt + Left/Right">
<span class="level">${f.id}</span>${escape_html(f.shortName)}</button>`).join('');
        const f = this.indexes.floors.get(this.floor);
        get_element('floorName').textContent = f ? `Floor ${this.floor} · ${f.name}` : 'No floors';
        get_element('editFloor').hidden = !f;
    }

    render_board() {
        for (const node of document.querySelectorAll('[data-wall-scroll]')) {
            this.wall_scrolls.set(node.dataset.floor + ':' + node.dataset.wallScroll, {
                left: node.scrollLeft,
                top: node.scrollTop
            });
        }
        get_element('map').classList.toggle('empty-map', !this.indexes.floors.has(this.floor));
        const f = this.indexes.floors.get(this.floor);
        const names = {
            T: 'Top',
            R: 'Right',
            B: 'Bottom',
            L: 'Left'
        };
        const walls = f ? ['T', 'R', 'B', 'L'].map(wall => {
            if (!f.walls.includes(wall)) {
                return `<div class="wall-opening wall-${wall}">Open</div>`;
            }
            const squares = this.layout.squares.filter(s => s.floor === this.floor && s.wall === wall).sort((a, b) => a.section - b.section);
            return `<section class="wall-panel wall-${wall}" aria-label="${names[wall]} wall">
<div class="wall-scroll" data-wall-scroll="${wall}" data-floor="${this.floor}" tabindex="0" aria-label="${names[wall]} wall, ${squares.length} modules">
<div class="wall-contents">${squares.map(s => `<section class="square" aria-label="${s.id}">
<div class="square-heading">
<span>${s.id}</span>
</div>
<div class="square-grid">${Layout.displaySlotsOf(s).map(id => this.tile(this.layout.placements[id], id)).join('')}</div>
</section>`).join('')}</div>
</div>
</section>`;
        }).join('') : '';
        get_element('map').innerHTML = walls + `<div class="workspace ${f ? '' : 'without-floor'}">
<section id="inspector" class="inspector" aria-label="Selected chest contents">
</section>
<section class="staging" aria-label="Shared chest staging">
<div class="staging-heading">
<h2>Staging</h2>
<span class="stage-count">${this.layout.staging.length}</span>
<span class="stage-scope">All floors</span>
<button id="newChest" type="button" class="chest-control">+ Chest</button>
</div>
<div id="stagingDrop" class="staging-drop ${this.picked ? 'pick-target' : ''}" tabindex="0" role="group" aria-label="Staging area; drop chests here">${this.layout.staging.length ? this.layout.staging.map(id => this.tile(id)).join('') : '<div class="stage-empty">Drop chests here</div>'}</div>
</section>
</div>`;
        for (const node of document.querySelectorAll('[data-wall-scroll]')) {
            const previous = this.wall_scrolls.get(this.floor + ':' + node.dataset.wallScroll);
            if (previous) {
                node.scrollLeft = previous.left;
                node.scrollTop = previous.top;
            }
        }
        this.render_inspector();
    }

    render_inspector() {
        const c = this.indexes.chests.get(this.selected);
        if (!c) {
            get_element('inspector').innerHTML = `<p class="empty-detail">${this.layout.floors.length ? 'Select or create a chest.' : 'Add a floor or create a chest to start.'}</p>`;
            return;
        }
        const location = this.indexes.locations.get(this.selected);
        const actions = `<div class="inspector-actions">
<button type="button" data-action="edit">Edit</button>
<button type="button" data-action="pick">${this.picked ? 'Cancel move' : 'Move'}</button>${location !== null ? '<button type="button" data-action="stage" title="Move this chest to staging">Stage</button>' : ''}<button type="button" class="danger quiet" data-action="delete">Delete</button>
</div>`;
        const picked_name = this.picked ? this.indexes.chests.get(this.picked)?.label : '';
        get_element('inspector').innerHTML = `<div class="inspector-head">
<div>
<span class="eyebrow">${location || 'Staging'}</span>
<h2>${escape_html(c.label)}</h2>
</div>${actions}</div>${c.items.length ? `<ul class="item-list">${c.items.map(i => `<li title="${escape_html(i.itemId || 'Custom item')}">
<span>${escape_html(i.name)}${i.name === 'Music Disc' && i.itemId ? `<small class="item-variant">${escape_html(i.itemId.replace('minecraft:music_disc_', '').replace(/_/g, ' '))}</small>` : ''}</span>
</li>`).join('')}</ul>` : '<p class="empty-detail">No items yet.</p>'}${this.picked ? `<div class="move-hint">Place ${escape_html(picked_name)} in a slot or staging. Esc to cancel.</div>` : ''}`;
    }

    mark_selection() {
        for (const node of document.querySelectorAll('[data-chest]')) {
            const active = node.dataset.chest === this.selected;
            node.classList.toggle('selected', active);
            node.classList.toggle('picked', node.dataset.chest === this.picked);
            if (node.classList.contains('chest')) {
                node.setAttribute('aria-pressed', String(active));
            }
        }
        document.body.classList.toggle('moving', !!this.picked);
        get_element('stagingDrop')?.classList.toggle('pick-target', !!this.picked);
    }

    render() {
        this.render_floors();
        this.render_board();
        this.mark_selection();
        this.render_search();
        get_element('undo').disabled = !this.undo_stack.length;
        get_element('redo').disabled = !this.redo_stack.length;
        get_element('clearLayout').disabled = !this.layout.floors.length && !this.layout.chests.length;
    }

    select_chest(id, jump = false) {
        if (!this.indexes.chests.has(id)) {
            return;
        }
        this.selected = id;
        const location = this.indexes.locations.get(id);
        const target_floor = location ? this.indexes.slots.get(location).floor : this.floor;
        if (jump && target_floor !== this.floor) {
            this.floor = target_floor;
            this.render();
        } else {
            this.render_inspector();
            this.mark_selection();
        }
        if (jump) {
            const target = location ? get_element('slot-' + location) : get_element('stagingDrop');
            target?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: 'smooth'
            });
            if (location) {
                target?.focus({
                    preventScroll: true
                });
            }
        }
    }

    set_floor(id) {
        if (!this.indexes.floors.has(id)) {
            return;
        }
        this.floor = id;
        // Keep a picked chest across floor switches; ordinary browsing selects this floor.
        if (!this.picked) {
            const current = this.indexes.locations.get(this.selected);
            if (current && this.indexes.slots.get(current)?.floor !== this.floor) {
                const square = this.layout.squares.find(s => s.floor === this.floor);
                const local = Layout.slotsOf(square).map(s => this.layout.placements[s]).find(Boolean);
                if (local) {
                    this.selected = local;
                }
            }
        }
        this.render();
        this.save();
    }

    matching_chests(query) {
        const words = normalize(query).replace(/(f\d+[trlb][1-9]\d*-)([ud])([1-3])/g, (all, base, row, col) => base + (row === 'u' ? 't' : 'b') + col).trim().split(/\s+/).filter(Boolean);
        if (!words.length) {
            return [];
        }
        return this.layout.chests.filter(c => {
            const location = this.indexes.locations.get(c.id);
            const text = normalize([location || 'staging', c.label, c.family, ...c.items.flatMap(i => [i.name, i.itemId])].join(' '));
            return words.every(word => text.includes(word));
        });
    }

    render_search() {
        const query = get_element('search').value.trim(),
            box = get_element('results');
        const matches = query ? this.matching_chests(query) : [],
            ids = new Set(matches.map(c => c.id));
        box.hidden = !query;
        get_element('search').setAttribute('aria-expanded', String(!!query));
        for (const node of document.querySelectorAll('.chest[data-chest]')) {
            node.classList.toggle('search-dim', !!query && !ids.has(node.dataset.chest));
            node.classList.toggle('search-match', !!query && ids.has(node.dataset.chest));
        }
        box.innerHTML = query ? `<div class="result-count">${matches.length} matching chest${matches.length === 1 ? '' : 's'}${matches.length > 60 ? ' · first 60 shown' : ''}</div>` + matches.slice(0, 60).map(c => {
            const location = this.indexes.locations.get(c.id);
            return `<button type="button" class="result" data-find="${escape_html(c.id)}">
<small>${location || 'Staging'}</small>
<strong>${escape_html(c.label)}</strong>
<span class="result-items">${escape_html(c.items.map(i => i.name).join(', '))}</span>
</button>`;
        }).join('') : '';
    }

    close_search(clear = false) {
        if (clear) {
            get_element('search').value = '';
            this.render_search();
        } else {
            get_element('results').hidden = true;
            get_element('search').setAttribute('aria-expanded', 'false');
        }
    }

    async import_layout(file) {
        if (!file) {
            return;
        }
        try {
            if (file.size > 64 * 1024 * 1024) {
                throw new Error('The file is larger than 64 MB.');
            }
            const next = this.read_layout(JSON.parse(await file.text()));
            this.show_error('');
            this.clear_drag();
            this.commit(next, 'Layout imported');
        } catch (error) {
            this.show_error('Import failed: ' + error.message);
        }
    }

    export_layout() {
        const json = JSON.stringify(Layout.exportDocument(this.layout), null, 2);
        const url = URL.createObjectURL(new Blob([json], {
            type: 'application/json'
        }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'copper-layouts-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.notify('Complete layout exported');
    }

    clear_drag() {
        if (this.drop_highlight) {
            this.drop_highlight.classList.remove('drop-target');
        }
        this.drop_highlight = null;
        this.dragged = null;
        this.dragged_floor = null;
        document.body.classList.remove('is-dragging');
        document.querySelectorAll('.dragging').forEach(n => n.classList.remove('dragging'));
    }

    reorder_floor(target_id, after = false) {
        if (this.dragged_floor === null || this.dragged_floor === target_id) {
            return;
        }
        const order = this.layout.floors.map(f => f.id).filter(id => id !== this.dragged_floor);
        order.splice(order.indexOf(target_id) + (after ? 1 : 0), 0, this.dragged_floor);
        this.floor = order.indexOf(this.floor);
        const next = Layout.reorderFloors(this.layout, order);
        this.clear_drag();
        this.commit(next, 'Floor order updated');
    }

    drop_target(event) {
        return event.target.closest('[data-slot]') || event.target.closest('#stagingDrop');
    }

    _bind_events() {
        document.addEventListener('dragstart', event => {
            const floor_button = event.target.closest('button[data-floor]');
            if (floor_button) {
                this.dragged_floor = Number(floor_button.dataset.floor);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-copper-layout-floor', String(this.dragged_floor));
                floor_button.classList.add('dragging');
                return;
            }
            const node = event.target.closest('.chest[data-chest]');
            if (!node) {
                return;
            }
            this.dragged = node.dataset.chest;
            this.selected = this.dragged;
            this.picked = null;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-minecraft-storage-chest', this.dragged);
            event.dataTransfer.setData('text/plain', this.dragged);
            node.classList.add('dragging');
            document.body.classList.add('is-dragging');
            this.render_inspector();
            this.mark_selection();
        });
        document.addEventListener('dragover', event => {
            if (this.dragged_floor !== null) {
                const target = event.target.closest('button[data-floor]');
                this.drop_highlight?.classList.remove('drop-target');
                this.drop_highlight = target;
                target?.classList.add('drop-target');
                if (target) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                }
                return;
            }
            if (!this.dragged) {
                return;
            }
            const target = this.drop_target(event);
            if (this.drop_highlight !== target) {
                this.drop_highlight?.classList.remove('drop-target');
                this.drop_highlight = target;
                target?.classList.add('drop-target');
            }
            if (target) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            }
        });
        document.addEventListener('dragleave', event => {
            if (!event.relatedTarget && this.drop_highlight) {
                this.drop_highlight.classList.remove('drop-target');
                this.drop_highlight = null;
            }
        });
        document.addEventListener('drop', event => {
            if (this.dragged_floor !== null) {
                event.preventDefault();
                const target = event.target.closest('button[data-floor]');
                if (target) {
                    const bounds = target.getBoundingClientRect();
                    this.reorder_floor(Number(target.dataset.floor), event.clientX > bounds.x + bounds.width / 2);
                }
                this.clear_drag();
                this.ignore_click_until = Date.now() + 180;
                return;
            }
            if (!this.dragged) {
                return;
            }
            event.preventDefault();
            const target = this.drop_target(event),
                id = this.dragged;
            this.clear_drag();
            this.ignore_click_until = Date.now() + 180;
            if (target) {
                this.move_chest(id, target.dataset.slot || null);
            }
        });
        document.addEventListener('dragend', () => {
            this.ignore_click_until = Date.now() + 180;
            this.clear_drag();
        });
        document.addEventListener('click', event => {
            if (Date.now() < this.ignore_click_until) {
                return;
            }
            const button = event.target.closest('button');
            if (button?.dataset.floor !== undefined) {
                this.set_floor(Number(button.dataset.floor));
                return;
            }
            if (button?.dataset.find) {
                this.close_search(true);
                this.select_chest(button.dataset.find, true);
                return;
            }
            if (this.picked && event.target.closest('#stagingDrop')) {
                this.move_chest(this.picked, null);
                return;
            }
            if (button?.dataset.slot && this.picked) {
                this.move_chest(this.picked, button.dataset.slot);
                return;
            }
            if (button?.dataset.chest) {
                this.select_chest(button.dataset.chest);
                return;
            }
            if (button?.dataset.slot) {
                this.editor.open_chest_editor(null, button.dataset.slot);
                return;
            }
            if (button?.dataset.action === 'edit') {
                this.editor.open_chest_editor(this.selected);
                return;
            }
            if (button?.dataset.action === 'delete') {
                this.commit(Layout.deleteChest(this.layout, this.selected), 'Chest deleted · Undo to restore');
                return;
            }
            if (button?.dataset.action === 'pick') {
                this.picked = this.picked ? null : this.selected;
                this.render_inspector();
                this.mark_selection();
                return;
            }
            if (button?.dataset.action === 'stage') {
                this.move_chest(this.selected, null);
                return;
            }
            if (!event.target.closest('.search-wrap')) {
                this.close_search();
            }
        });
        get_element('undo').addEventListener('click', event => this.undo(event));
        get_element('redo').addEventListener('click', event => this.redo(event));
        get_element('export').addEventListener('click', event => this.export_layout(event));
        get_element('import').addEventListener('click', () => get_element('importFile').click());
        get_element('importFile').addEventListener('change', event => {
            const file = event.target.files[0];
            event.target.value = '';
            this.import_layout(file);
        });
        get_element('search').addEventListener('input', event => this.render_search(event));
        get_element('search').addEventListener('focus', () => {
            if (get_element('search').value.trim()) {
                this.render_search();
            }
        });
        get_element('search').addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                get_element('results').querySelector('button')?.focus();
            }
            if (event.key === 'Enter') {
                const result = this.matching_chests(get_element('search').value)[0];
                if (result) {
                    event.preventDefault();
                    this.close_search(true);
                    this.select_chest(result.id, true);
                }
            }
        });
        document.addEventListener('keydown', event => {
            if (document.querySelector('dialog[open]')) {
                return;
            }
            if (event.altKey && event.target.matches('button[data-floor]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                const order = this.layout.floors.map(f => f.id),
                    current = Number(event.target.dataset.floor);
                const target = order[order.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1)];
                if (target !== undefined) {
                    event.preventDefault();
                    this.dragged_floor = current;
                    this.reorder_floor(target, event.key === 'ArrowRight');
                }
                return;
            }
            if (event.key === 'Escape') {
                this.picked = null;
                this.clear_drag();
                this.close_search(true);
                this.render_inspector();
                this.mark_selection();
                return;
            }
            if (event.target.matches('input,textarea,[contenteditable]')) {
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.shiftKey ? this.redo() : this.undo();
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                this.redo();
            }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.id === 'stagingDrop' && this.picked) {
                event.preventDefault();
                this.move_chest(this.picked, null);
            }
        });
    }
}
