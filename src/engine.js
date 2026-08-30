// A single requestAnimationFrame loop shared by every actor.
// An actor is anything with update(dt) and draw(ctx). Either may be omitted.
export class Engine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.actors = [];
        this.animationId = null;
        this.isRunning = false;
        this.lastTime = 0;
    }

    add(actor) {
        this.actors.push(actor);
        return actor;
    }

    remove(actor) {
        const i = this.actors.indexOf(actor);
        if (i !== -1) {
            this.actors.splice(i, 1);
        }
    }

    clear() {
        this.actors.length = 0;
    }

    tick(now) {
        // Seconds since the last frame, clamped so a backgrounded tab doesn't
        // resume with one enormous step.
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (const actor of this.actors) {
            if (actor.update) {
                actor.update(dt);
            }
        }
        for (const actor of this.actors) {
            if (actor.draw) {
                actor.draw(this.ctx);
            }
        }

        this.animationId = requestAnimationFrame(this.tick.bind(this));
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.animationId = requestAnimationFrame(this.tick.bind(this));
    }

    stop() {
        this.isRunning = false;
        cancelAnimationFrame(this.animationId);
    }
}
