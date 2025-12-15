import { GameData } from './data.js';

// Deep copy to avoid mutating the original import directly
let appData = JSON.parse(JSON.stringify(GameData));
let currentTab = 'items';
let selectedId = null;

// DOM Elements
const listContainer = document.getElementById('item-list');
const editorForm = document.getElementById('editor-form');
const formFields = document.getElementById('form-fields');
const emptyState = document.getElementById('empty-state');
const pageTitle = document.getElementById('page-title');

// Event Listeners
document.getElementById('tab-items').addEventListener('click', () => switchTab('items'));
document.getElementById('tab-monsters').addEventListener('click', () => switchTab('monsters'));
document.getElementById('tab-spells').addEventListener('click', () => switchTab('spells'));
document.getElementById('tab-boss').addEventListener('click', () => switchTab('boss'));
document.getElementById('tab-objects').addEventListener('click', () => switchTab('objects'));
document.getElementById('tab-env').addEventListener('click', () => switchTab('environment'));

document.getElementById('btn-add-new').addEventListener('click', addNewItem);
document.getElementById('btn-export').addEventListener('click', exportData);

// Event Delegation for Form Fields
formFields.addEventListener('change', (e) => {
    if (e.target.matches('input') || e.target.matches('select')) {
        const key = e.target.dataset.key;
        const index = e.target.dataset.index; // Can be string for env
        let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;

        if (e.target.type === 'number') {
            value = parseFloat(value);
        }

        updateField(key, value, index);
    }
});

formFields.addEventListener('click', (e) => {
    if (e.target.matches('.delete-btn')) {
        const index = parseInt(e.target.dataset.index);
        deleteItem(index);
    }
});

// Tab Switching
function switchTab(tab) {
    currentTab = tab;
    selectedId = null;

    // Update UI
    document.querySelectorAll('nav button').forEach(btn => {
        btn.classList.remove('bg-white/10', 'text-white');
        btn.classList.add('text-slate-300');
    });

    // Map 'environment' to 'tab-env' ID
    const tabId = tab === 'environment' ? 'tab-env' : `tab-${tab}`;
    const activeTab = document.getElementById(tabId);

    if (activeTab) {
        activeTab.classList.add('bg-white/10', 'text-white');
        activeTab.classList.remove('text-slate-300');
    }

    pageTitle.innerText = tab.charAt(0).toUpperCase() + tab.slice(1);

    if (tab === 'environment') {
        listContainer.innerHTML = ''; // Clear list
        renderEnvForm();
    } else {
        renderList();
        hideForm();
    }
}

// Render Environment Form
function renderEnvForm() {
    emptyState.classList.add('hidden');
    editorForm.classList.remove('hidden');
    formFields.innerHTML = '';

    const envData = appData.environment;

    Object.keys(envData).forEach(key => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-1';

        const label = document.createElement('label');
        label.className = 'text-xs text-cyan-300 uppercase font-bold tracking-wider';
        label.innerText = key;

        let input;
        const value = envData[key];

        if (key.includes('Color')) {
            input = document.createElement('div');
            input.className = 'flex gap-2';
            input.innerHTML = `
                <input type="color" value="${value}" data-key="${key}" data-index="env" class="h-10 w-10 rounded cursor-pointer bg-transparent border-0">
                <input type="text" value="${value}" data-key="${key}" data-index="env" class="glass-input flex-1 px-3 py-2 rounded-lg">
            `;
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.dataset.key = key;
            input.dataset.index = 'env';
            input.className = 'glass-input w-full px-3 py-2 rounded-lg';
        }

        wrapper.appendChild(label);
        if (input.tagName === 'DIV') {
            wrapper.appendChild(input);
        } else {
            wrapper.appendChild(input);
        }
        formFields.appendChild(wrapper);
    });
}

// Render List
function renderList() {
    listContainer.innerHTML = '';

    let items = [];
    if (currentTab === 'boss') {
        items = [appData.boss];
    } else {
        items = appData[currentTab] || [];
    }

    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `p-3 rounded-lg cursor-pointer transition-all border border-transparent hover:border-white/10 ${selectedId === (item.id || 'boss') ? 'bg-cyan-900/30 border-cyan-500/30' : 'bg-white/5 hover:bg-white/10'}`;
        div.onclick = () => selectItem(item, index);

        div.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-medium text-slate-200">${item.name || 'Sans nom'}</span>
                <span class="text-xs text-slate-500">${item.id || ''}</span>
            </div>
            <div class="text-xs text-slate-400 mt-1 truncate">
                ${getDescription(item)}
            </div>
        `;
        listContainer.appendChild(div);
    });
}

function getDescription(item) {
    if (currentTab === 'items') return `Type: ${item.type}`;
    if (currentTab === 'monsters') return `HP: ${item.hp} | Dmg: ${item.damage}`;
    if (currentTab === 'spells') return `Dmg: ${item.damage} | CD: ${item.cooldown}`;
    if (currentTab === 'objects') return `Type: ${item.type}`;
    if (currentTab === 'boss') return `HP: ${item.hp} | Boss`;
    return '';
}

// Select Item
function selectItem(item, index) {
    selectedId = item.id || 'boss';
    renderList(); // Re-render to update active state
    showForm(item, index);
}

// Show Form
function showForm(item, index) {
    emptyState.classList.add('hidden');
    editorForm.classList.remove('hidden');
    formFields.innerHTML = '';

    // Generate fields based on object keys
    Object.keys(item).forEach(key => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-1';

        const label = document.createElement('label');
        label.className = 'text-xs text-cyan-300 uppercase font-bold tracking-wider';
        label.innerText = key;

        let input;
        const value = item[key];
        const type = typeof value;

        if (key === 'color' || key.includes('Color')) {
            input = document.createElement('div');
            input.className = 'flex gap-2';
            input.innerHTML = `
                <input type="color" value="${value}" data-key="${key}" data-index="${index}" class="h-10 w-10 rounded cursor-pointer bg-transparent border-0">
                <input type="text" value="${value}" data-key="${key}" data-index="${index}" class="glass-input flex-1 px-3 py-2 rounded-lg">
            `;
        } else if (type === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.value = value;
            input.dataset.key = key;
            input.dataset.index = index;
            input.className = 'glass-input w-full px-3 py-2 rounded-lg';
        } else if (type === 'boolean') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = value;
            input.dataset.key = key;
            input.dataset.index = index;
            input.className = 'h-5 w-5 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500';
        } else if (Array.isArray(value)) {
            // Simple array display for now (lootTable)
            input = document.createElement('input');
            input.type = 'text';
            input.value = JSON.stringify(value); // Edit as JSON string
            input.dataset.key = key;
            input.dataset.index = index;
            input.className = 'glass-input w-full px-3 py-2 rounded-lg';
            input.placeholder = '["item_id_1", "item_id_2"]';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.dataset.key = key;
            input.dataset.index = index;
            input.className = 'glass-input w-full px-3 py-2 rounded-lg';
        }

        wrapper.appendChild(label);
        if (input.tagName === 'DIV') {
            wrapper.appendChild(input);
        } else {
            wrapper.appendChild(input);
        }
        formFields.appendChild(wrapper);
    });

    // Delete Button (except for Boss)
    if (currentTab !== 'boss') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn mt-6 w-full py-2 bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded-lg transition-colors border border-red-500/30';
        deleteBtn.innerText = 'Supprimer cet élément';
        deleteBtn.dataset.index = index;
        formFields.appendChild(deleteBtn);
    }
}

function hideForm() {
    emptyState.classList.remove('hidden');
    editorForm.classList.add('hidden');
}

// Update Field
function updateField(key, value, index) {
    if (currentTab === 'environment') {
        appData.environment[key] = value;
    } else if (currentTab === 'boss') {
        appData.boss[key] = value;
    } else {
        // Handle array parsing for lootTable
        if (key === 'lootTable' && typeof value === 'string') {
            try {
                value = JSON.parse(value);
            } catch (e) {
                console.warn("Invalid JSON for lootTable");
                return; // Don't update if invalid
            }
        }
        appData[currentTab][index][key] = value;
    }

    if (currentTab !== 'environment') {
        renderList();
    }
}

// Add New Item
function addNewItem() {
    if (currentTab === 'boss' || currentTab === 'environment') return;

    const newItem = {};
    // Template based on tab
    if (currentTab === 'items') {
        Object.assign(newItem, {
            id: 'new_item', name: 'Nouvel Item', type: 'misc', icon: '?',
            sprite: '', rarity: 'common', spawnChance: 0.1
        });
    } else if (currentTab === 'monsters') {
        Object.assign(newItem, {
            id: 'new_mob', name: 'Nouveau Monstre', hp: 10, damage: 1,
            color: '#ffffff', scale: 1, sprite: '', sound: 'default', spawnChance: 0.1
        });
    } else if (currentTab === 'spells') {
        Object.assign(newItem, {
            id: 'new_spell', name: 'Nouveau Sort', damage: 10,
            color: '#ffffff', cooldown: 1, sound: 'zap'
        });
    } else if (currentTab === 'objects') {
        Object.assign(newItem, {
            id: 'new_chest', name: 'Nouveau Coffre', type: 'chest',
            sprite: 'assets/sprites/chest_closed.png', spriteOpen: 'assets/sprites/chest_opened.png',
            scale: 1, lootTable: [], spawnChance: 0.1
        });
    }

    appData[currentTab].push(newItem);
    renderList();
    selectItem(newItem, appData[currentTab].length - 1);
}

// Delete Item
function deleteItem(index) {
    if (confirm('Êtes-vous sûr de vouloir supprimer cet élément ?')) {
        appData[currentTab].splice(index, 1);
        renderList();
        hideForm();
    }
}

// Export Data
function exportData() {
    const dataString = `export const GameData = ${JSON.stringify(appData, null, 4)};`;

    // Create a blob and download
    const blob = new Blob([dataString], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Fichier data.js généré ! Remplacez le fichier existant dans le dossier js/');
}

// Init
switchTab('items');
