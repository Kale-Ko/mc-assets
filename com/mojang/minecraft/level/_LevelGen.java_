package com.mojang.minecraft.level;

import java.util.Random;

import com.mojang.minecraft.level.tile.Tile;

public class LevelGen
{
    private int width, height, depth;
    private Random random = new Random();
    private boolean islandMode;

    public LevelGen(int width, int height, int depth, boolean islandMode)
    {
        this.width = width;
        this.height = height;
        this.depth = depth;
        this.islandMode = islandMode;
    }

    public byte[] generateMap()
    {
        int w = width;
        int h = height;
        int d = depth;
        int[] heightmap1 = new NoiseMap(random, 0, islandMode).read(w, h);
        int[] heightmap2 = new NoiseMap(random, 1, islandMode).read(w, h);
        int[] cf = new NoiseMap(random, 3, false).read(w, h);
        int[] cf2 = new NoiseMap(random, 3, false).read(w, h);
        int[] rockMap = new NoiseMap(random, 1, islandMode).read(w, h);
        byte[] blocks = new byte[width * height * depth];

        int waterLevel = d / 2;

        for (int x = 0; x < w; x++)
            for (int y = 0; y < d; y++)
                for (int z = 0; z < h; z++)
                {
                    int dh1 = heightmap1[x + z * width];
                    int dh2 = heightmap2[x + z * width];
                    int cfh = cf[x + z * width];
                    int cfh2 = cf2[x + z * width];

                    if (cfh < 128) dh2 = dh1;

                    int dh = dh1;
                    if (dh2 > dh)
                        dh = dh2;
                    else
                        dh2 = dh1;
                    dh = (dh - 128) / 8;
                    dh = dh + waterLevel - 3;

                    //                    dh = dh+d/2-4;
                    //                    dh = (dh / 2 + (d / 2-4))/2;

                    //                    dh -= hh;

                    int rh = ((rockMap[x + z * width] - 128) / 6 + waterLevel + dh) / 2;
                    if (cfh2 < 50)
                    {
                        dh = (dh / 4 * 4)-3;
                    }
                    else if (cfh2 < 132)
                    {
                        dh = (dh / 2 * 2)-1;
                    }
                    int ww = waterLevel-2;
                    if (dh < ww)
                    {
                        dh = (dh - ww) / 2 + ww;
                    }

                    if (rh > dh - 2) rh = dh - 2;
                    //                    rh = (dh1+dh2*4)/5/16+d/2-2;
                    //                    rh = dh-2;
                    int i = (y * height + z) * width + x;
                    int id = 0;
                    if (y == dh && y >= d / 2-1) id = Tile.grass.id;
                    else if (y <= dh) id = Tile.dirt.id;
                    if (y <= rh) id = Tile.rock.id;
                    //                    if (id==0 && y<d/2 && (x==0 || z==0 || x==w-1 || z==h-1))
                    //                    {
                    //                        id = Tile.water.id;
                    //                    }
                    blocks[i] = (byte) id;
                }
        return blocks;
    }


    public byte[] carveTunnels(byte[] blocks)
    {
        int w = width;
        int h = height;
        int d = depth;
        
        int count = w * h * d / 256 / 64;
        for (int i = 0; i < count; i++)
        {
            float x = random.nextFloat() * w;
            float y = random.nextFloat() * d;
            float z = random.nextFloat() * h;
            int length = (int) (random.nextFloat() + random.nextFloat() * 150);
            float dir1 = (float) (random.nextFloat() * Math.PI * 2);
            float dira1 = 0;
            float dir2 = (float) (random.nextFloat() * Math.PI * 2);
            float dira2 = 0;

            for (int l = 0; l < length; l++)
            {
                x += Math.sin(dir1) * Math.cos(dir2);
                z += Math.cos(dir1) * Math.cos(dir2);
                y += Math.sin(dir2);

                dir1 += dira1 * 0.2f;
                dira1 *= 0.9f;
                dira1 += (random.nextFloat() - random.nextFloat());

                dir2 += dira2 * 0.5f;
                dir2 *= 0.5f;
                dira2 *= 0.9f;
                dira2 += (random.nextFloat() - random.nextFloat());

                float size = (float) (Math.sin(l * Math.PI / length) * 2.5 + 1);

                for (int xx = (int) (x - size); xx <= (int) (x + size); xx++)
                    for (int yy = (int) (y - size); yy <= (int) (y + size); yy++)
                        for (int zz = (int) (z - size); zz <= (int) (z + size); zz++)
                        {
                            float xd = xx - x;
                            float yd = yy - y;
                            float zd = zz - z;
                            float dd = xd * xd + (yd * yd) * 2 + zd * zd;
                            if (dd < size * size && xx >= 1 && yy >= 1 && zz >= 1 && xx < width - 1 && yy < depth - 1 && zz < height - 1)
                            {
                                int ii = (yy * height + zz) * width + xx;
                                if (blocks[ii] == Tile.rock.id)
                                {
                                    blocks[ii] = 0;
                                }
                            }
                        }
            }
        }
        return blocks;
    }
}