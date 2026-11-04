package com.nightmare;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.*;

public class NightmareMod implements ModInitializer {
    public static final String MOD_ID = "nightmare";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final Random RNG = new Random();
    private static final int DARK_LIGHT_LEVEL = 7;
    private static final int MIN_DELAY_TICKS = 900;
    private static final int MAX_DELAY_TICKS = 2400;
    private static final SoundEvent[] DREAD_SOUNDS = {
        SoundEvents.ENDERMAN_STARE, SoundEvents.ENDERMAN_SCREAM, SoundEvents.GHAST_WARN,
        SoundEvents.WITHER_AMBIENT, SoundEvents.ZOMBIE_AMBIENT, SoundEvents.SKELETON_AMBIENT,
        SoundEvents.ELDER_GUARDIAN_CURSE, SoundEvents.WOODEN_DOOR_OPEN
    };
    private static final String[] WHISPERS = {
        "Don't look behind you.", "It's still here.", "You are not alone.",
        "Why did you leave the light?", "I can see you.", "Run."
    };
    private static boolean enabled = true;
    private static final Map<UUID, Long> NEXT_SCARE = new HashMap<>();
    private static final Map<UUID, Watcher> WATCHERS = new HashMap<>();
    private static final List<Task> TASKS = new ArrayList<>();
    private record Task(long runAt, Runnable action) {}
    private record Watcher(Entity entity, long expiresAt) {}

    @Override public void onInitialize() {
        ServerTickEvents.END_SERVER_TICK.register(NightmareMod::tick);
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            WATCHERS.values().forEach(w -> w.entity().discard());
            WATCHERS.clear(); TASKS.clear(); NEXT_SCARE.clear();
        });
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
            dispatcher.register(Commands.literal("nightmare")
                .then(Commands.literal("on").executes(ctx -> {
                    enabled = true;
                    ctx.getSource().sendSuccess(() -> Component.literal("Nightmare: ON"), false);
                    return 1;
                }))
                .then(Commands.literal("off").executes(ctx -> {
                    enabled = false;
                    ctx.getSource().sendSuccess(() -> Component.literal("Nightmare: OFF"), false);
                    return 1;
                }))
                .then(Commands.literal("scare").executes(ctx -> {
                    ServerPlayer player = ctx.getSource().getPlayerOrException();
                    if (player.level() instanceof ServerLevel level)
                        triggerScare(player, level, ctx.getSource().getServer().getTickCount());
                    return 1;
                }))
            ));
        LOGGER.info("Nightmare loaded. Sleep tight.");
    }

    private static void tick(MinecraftServer server) {
        long now = server.getTickCount();
        List<Task> due = new ArrayList<>();
        TASKS.removeIf(t -> { if (t.runAt() <= now) { due.add(t); return true; } return false; });
        for (Task task : due) task.action().run();
        updateWatchers(server, now);
        if (!enabled || now % 20 != 0) return;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator()) continue;
            UUID id = player.getUUID();
            Long next = NEXT_SCARE.get(id);
            if (next == null) { NEXT_SCARE.put(id, now + between(MIN_DELAY_TICKS, MAX_DELAY_TICKS)); continue; }
            if (now < next || WATCHERS.containsKey(id)) continue;
            if (!(player.level() instanceof ServerLevel level)) continue;
            if (level.getMaxLocalRawBrightness(player.blockPosition()) > DARK_LIGHT_LEVEL) continue;
            triggerScare(player, level, now);
            NEXT_SCARE.put(id, now + between(MIN_DELAY_TICKS, MAX_DELAY_TICKS));
        }
    }

    private static void updateWatchers(MinecraftServer server, long now) {
        Iterator<Map.Entry<UUID, Watcher>> it = WATCHERS.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<UUID, Watcher> entry = it.next();
            Watcher watcher = entry.getValue();
            ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
            if (player == null || watcher.entity().isRemoved() || now >= watcher.expiresAt()
                || player.level() != watcher.entity().level()) {
                watcher.entity().discard(); it.remove(); continue;
            }
            Vec3 toWatcher = watcher.entity().getEyePosition().subtract(player.getEyePosition()).normalize();
            if (player.getLookAngle().dot(toWatcher) > 0.94 && player.hasLineOfSight(watcher.entity())) {
                vanish(player, watcher.entity()); it.remove();
            }
        }
    }

    private static void triggerScare(ServerPlayer player, ServerLevel level, long now) {
        int roll = RNG.nextInt(100);
        if (roll < 35) farSound(player, level);
        else if (roll < 60) footstepsBehind(player, level, now);
        else if (roll < 75) heartbeatAndDarkness(player, now);
        else if (!spawnWatcher(player, level, now)) farSound(player, level);
    }

    private static void farSound(ServerPlayer player, ServerLevel level) {
        double angle = RNG.nextDouble() * Math.PI * 2;
        double distance = 10 + RNG.nextInt(8);
        double x = player.getX() + Math.cos(angle) * distance;
        double z = player.getZ() + Math.sin(angle) * distance;
        SoundEvent sound = DREAD_SOUNDS[RNG.nextInt(DREAD_SOUNDS.length)];
        level.playSound(null, x, player.getY(), z, sound, SoundSource.AMBIENT, 1.2f,
            0.5f + RNG.nextFloat() * 0.3f);
    }

    private static void footstepsBehind(ServerPlayer player, ServerLevel level, long now) {
        for (int i = 0; i < 6; i++) {
            final double distance = 7.0 - i;
            TASKS.add(new Task(now + i * 10L, () -> {
                if (player.isRemoved()) return;
                Level current = player.level();
                Vec3 look = player.getLookAngle();
                double x = player.getX() - look.x * distance;
                double z = player.getZ() - look.z * distance;
                BlockPos below = BlockPos.containing(x, player.getY() - 0.5, z);
                SoundEvent step = current.getBlockState(below).getSoundType().getStepSound();
                current.playSound(null, x, player.getY(), z, step, SoundSource.HOSTILE, 1.0f, 0.8f);
            }));
        }
    }

    private static void heartbeatAndDarkness(ServerPlayer player, long now) {
        for (int i = 0; i < 3; i++) TASKS.add(new Task(now + i * 14L, () -> {
            if (!player.isRemoved()) player.level().playSound(null, player.getX(), player.getY(),
                player.getZ(), SoundEvents.WARDEN_HEARTBEAT, SoundSource.AMBIENT, 1.5f, 1.0f);
        }));
        player.addEffect(new MobEffectInstance(MobEffects.DARKNESS, 140, 0));
        whisper(player);
    }

    private static boolean spawnWatcher(ServerPlayer player, ServerLevel level, long now) {
        Vec3 look = player.getLookAngle();
        for (int attempt = 0; attempt < 12; attempt++) {
            double angle = RNG.nextDouble() * Math.PI * 2;
            double dx = Math.cos(angle), dz = Math.sin(angle);
            if (dx * look.x + dz * look.z > 0.3) continue;
            double distance = 18 + RNG.nextInt(10);
            int x = (int)Math.floor(player.getX() + dx * distance);
            int z = (int)Math.floor(player.getZ() + dz * distance);
            int y = level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
            if (Math.abs(y - player.getY()) > 12) continue;
            Entity entity = EntityType.ENDERMAN.spawn(level, new BlockPos(x, y, z), EntitySpawnReason.EVENT);
            if (entity == null) continue;
            entity.setSilent(true); entity.setInvulnerable(true);
            if (entity instanceof Mob mob) mob.setNoAi(true);
            entity.lookAt(EntityAnchorArgument.Anchor.EYES, player.getEyePosition());
            WATCHERS.put(player.getUUID(), new Watcher(entity, now + 20L * 30));
            level.playSound(null, player.getX(), player.getY(), player.getZ(),
                SoundEvents.WARDEN_HEARTBEAT, SoundSource.AMBIENT, 1.0f, 0.9f);
            return true;
        }
        return false;
    }

    private static void vanish(ServerPlayer player, Entity watcher) {
        player.level().playSound(null, watcher.getX(), watcher.getY(), watcher.getZ(),
            SoundEvents.ENDERMAN_TELEPORT, SoundSource.HOSTILE, 1.0f, 0.5f);
        watcher.discard();
        player.addEffect(new MobEffectInstance(MobEffects.DARKNESS, 120, 0));
        whisper(player);
    }

    private static void whisper(ServerPlayer player) {
        String message = WHISPERS[RNG.nextInt(WHISPERS.length)];
        player.displayClientMessage(Component.literal(message)
            .withStyle(ChatFormatting.DARK_RED, ChatFormatting.ITALIC), true);
    }

    private static long between(int min, int max) { return min + RNG.nextInt(max - min + 1); }
}
