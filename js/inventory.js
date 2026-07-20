import { SLOTS } from './data.js';

// =====================================================================
//  INVENTAIRE - conteneur pur (effets appliques par game.js)
// =====================================================================
export class Inventory {
    constructor() {
        this.items = [];
        this.capacity = 100;
        this.equipment = {};
        SLOTS.forEach(s => this.equipment[s] = null);
    }

    addItem(item) {
        if (!item) return false;
        // Objets empilables : consommables et materiaux de craft.
        if (item.type === 'consumable' || item.type === 'material') {
            const ex = this.items.find(i => i.type === item.type && i.id === item.id);
            if (ex) { ex.qty = (ex.qty || 1) + (item.qty || 1); return true; }
            item.qty = item.qty || 1;
        }
        if (this.items.length < this.capacity) { this.items.push(item); return true; }
        return false;
    }
    removeItem(index) {
        if (index >= 0 && index < this.items.length) return this.items.splice(index, 1)[0];
        return null;
    }

    slotForItem(item) {
        if (!item) return null;
        const t = item.type;
        if (t === 'weapon') {
            // Slots dédiés : arme à distance et arme magique ne touchent pas la mêlée
            if (item.attackType === 'ranged') return 'ranged';   // arc / arbalète
            if (item.attackType === 'cast') return 'magic';       // bâton / sceptre
            // Mêlée : 1ère arme -> main ; 2ème arme 1-main -> main secondaire (dual-wield)
            if (!this.equipment.mainHand) return 'mainHand';
            if (item.hands === 1 && this.equipment.mainHand.hands === 1 && !this.equipment.offHand) return 'offHand';
            return 'mainHand';
        }
        if (t === 'shield' || t === 'torch' || t === 'offhand') return 'offHand';
        if (t === 'ring') return this.equipment.ring1 ? (this.equipment.ring2 ? 'ring1' : 'ring2') : 'ring1';
        if (SLOTS.includes(t)) return t;            // helmet/chest/legs/boots/belt/gloves/cape/necklace
        return null;
    }

    canAutoEquip(item) {
        const slot = this.slotForItem(item);
        if (!slot || this.equipment[slot]) return false;
        if (slot === 'mainHand' && item && item.hands === 2 && this.equipment.offHand) return false;
        if (slot === 'offHand' && this.equipment.mainHand && this.equipment.mainHand.hands === 2) return false;
        return true;
    }

    equipItem(index) {
        const item = this.items[index];
        const slot = this.slotForItem(item);
        if (!slot) return false;

        this.items.splice(index, 1);                // sort du sac

        // Arme a 2 mains : libere la main secondaire
        if (slot === 'mainHand' && item.hands === 2 && this.equipment.offHand) {
            this.items.push(this.equipment.offHand);
            this.equipment.offHand = null;
        }
        // Equiper une main secondaire alors qu'une arme 2 mains est en place : la retire
        if (slot === 'offHand' && this.equipment.mainHand && this.equipment.mainHand.hands === 2) {
            this.items.push(this.equipment.mainHand);
            this.equipment.mainHand = null;
        }

        const previous = this.equipment[slot];
        this.equipment[slot] = item;
        if (previous) this.items.push(previous);
        return true;
    }

    unequip(slot) {
        const item = this.equipment[slot];
        if (!item) return false;
        if (this.items.length >= this.capacity) return false;
        this.items.push(item);
        this.equipment[slot] = null;
        return true;
    }
}

export const playerInventory = new Inventory();
