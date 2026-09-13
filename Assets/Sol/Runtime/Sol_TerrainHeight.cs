using UnityEngine;

namespace Sol.GpuTerrain
{
    /// <summary>
    /// CPU mirror of the compute shader height function. It is used only for the
    /// validation camera's ground constraint; terrain geometry still comes from GPU data.
    /// </summary>
    public static class Sol_TerrainHeight
    {
        public const int DefaultSeed = 20260912;
        public const float DefaultFrequency = 0.0018f;
        public const float DefaultAmplitude = 110.0f;
        public const int OctaveCount = 6;

        public static float Sample(float worldX, float worldZ, int seed, float frequency, float amplitude)
        {
            float x = worldX * frequency;
            float z = worldZ * frequency;
            float octaveAmplitude = 1.0f;
            float octaveFrequency = 1.0f;
            float sum = 0.0f;
            float weight = 0.0f;

            for (int octave = 0; octave < OctaveCount; octave++)
            {
                sum += ValueNoise(x * octaveFrequency, z * octaveFrequency, seed + octave * 1013) * octaveAmplitude;
                weight += octaveAmplitude;
                octaveAmplitude *= 0.5f;
                octaveFrequency *= 2.0f;
            }

            float signedFbm = sum / weight * 2.0f - 1.0f;
            // A light signed-square shaping pass gives the broad FBM profile readable mountain crests.
            float shaped = signedFbm + signedFbm * Mathf.Abs(signedFbm) * 0.35f;
            return shaped * amplitude;
        }

        private static float ValueNoise(float x, float z, int seed)
        {
            int ix = Mathf.FloorToInt(x);
            int iz = Mathf.FloorToInt(z);
            float fx = x - ix;
            float fz = z - iz;
            float ux = fx * fx * (3.0f - 2.0f * fx);
            float uz = fz * fz * (3.0f - 2.0f * fz);

            float a = Hash01(ix, iz, seed);
            float b = Hash01(ix + 1, iz, seed);
            float c = Hash01(ix, iz + 1, seed);
            float d = Hash01(ix + 1, iz + 1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, ux), Mathf.Lerp(c, d, ux), uz);
        }

        private static float Hash01(int x, int y, int seed)
        {
            unchecked
            {
                uint hash = (uint)x * 374761393u + (uint)y * 668265263u + (uint)seed * 2246822519u;
                hash = (hash ^ (hash >> 13)) * 1274126177u;
                hash ^= hash >> 16;
                return (hash & 0x00FFFFFFu) / 16777215.0f;
            }
        }
    }
}
