import Tile from '../../components/layout/Tile';
import { registerGObjectClass } from '../../utils/gjs';
import { St, Clutter, Mtk } from '../../gi/ext';
import SnapAssistTile from '../../components/snapassist/snapAssistTile';

export default class SnapAssistTileButton extends SnapAssistTile {
    static { registerGObjectClass(this) }
    
    private readonly _btn: St.Button;

    constructor(params: {
        parent?: Clutter.Actor;
        rect?: Mtk.Rectangle;
        gaps?: Clutter.Margin;
        tile: Tile;
    }) {
        super(params);
        this._btn = new St.Button({
            xExpand: true,
            yExpand: true,
            trackHover: true,
        });
        this.add_child(this._btn);
        this._btn.set_size(this.innerWidth, this.innerHeight);

        // for some reason this doesn't work: this.bind_property("hover", this._btn, "hover", GObject.BindingFlags.DEFAULT);
        this._btn.connect('notify::hover', () =>
            this.set_hover(this._btn.hover),
        );
    }

    public get tile(): Tile {
        return this._tile;
    }

    public get checked(): boolean {
        return this._btn.checked;
    }

    public set_checked(newVal: boolean) {
        this._btn.set_checked(newVal);
    }

    public connect(_id: string, _callback: (..._args: any[]) => any): number;
    public connect(_signal: 'clicked', _callback: (_source: this, _clicked_button: number) => void): number;
    public connect(signal: string, callback: never): number {
        if (signal === 'clicked') return this._btn.connect(signal, callback);

        return super.connect(signal, callback);
    }
}
