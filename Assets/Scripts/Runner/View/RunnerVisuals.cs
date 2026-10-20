using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace TitanEarthfall.Runner.View
{
    /// <summary>
    /// Material cache and primitive builders, so the runner renders without authored prefabs.
    /// Materials derive from the render pipeline's default material, which works in Built-in and URP.
    /// </summary>
    public static class RunnerVisuals
    {
        private static readonly Dictionary<long, Material> Materials = new Dictionary<long, Material>();
        private static Material baseMaterial;

        public static Material Get(Color color, bool emissive = false, bool transparent = false)
        {
            long key = ((long)ColorKey(color) << 2) | (emissive ? 1L : 0L) | (transparent ? 2L : 0L);
            if (Materials.TryGetValue(key, out var material) && material != null) return material;

            material = new Material(BaseMaterial()) { name = $"Runner {ColorUtility.ToHtmlStringRGBA(color)}", enableInstancing = true };
            SetColor(material, color);
            if (emissive)
            {
                material.EnableKeyword("_EMISSION");
                material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
                if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", color * 1.6f);
            }
            if (transparent) MakeTransparent(material);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.25f);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.25f);
            Materials[key] = material;
            return material;
        }

        /// <summary>Creates a collider-free primitive parented to <paramref name="parent"/>.</summary>
        public static GameObject Part(Transform parent, PrimitiveType type, Vector3 localPosition, Vector3 localScale, Color color, bool emissive = false, bool transparent = false)
        {
            var part = GameObject.CreatePrimitive(type);
            var collider = part.GetComponent<Collider>();
            if (collider) Object.Destroy(collider);
            part.transform.SetParent(parent, false);
            part.transform.localPosition = localPosition;
            part.transform.localScale = localScale;
            var renderer = part.GetComponent<Renderer>();
            renderer.sharedMaterial = Get(color, emissive, transparent);
            if (transparent) renderer.shadowCastingMode = ShadowCastingMode.Off;
            return part;
        }

        public static void Paint(GameObject target, Color color, bool emissive = false)
        {
            var renderer = target.GetComponent<Renderer>();
            if (renderer) renderer.sharedMaterial = Get(color, emissive);
        }

        private static Material BaseMaterial()
        {
            if (baseMaterial) return baseMaterial;
            var probe = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var shared = probe.GetComponent<Renderer>().sharedMaterial;
            if (shared) baseMaterial = new Material(shared);
            Object.Destroy(probe);
            if (!baseMaterial)
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit");
                if (!shader) shader = Shader.Find("Standard");
                if (!shader) shader = Shader.Find("Legacy Shaders/Diffuse");
                baseMaterial = new Material(shader);
            }
            return baseMaterial;
        }

        private static void SetColor(Material material, Color color)
        {
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        }

        private static void MakeTransparent(Material material)
        {
            if (material.HasProperty("_Surface"))
            {
                // Universal Render Pipeline/Lit
                material.SetFloat("_Surface", 1f);
                material.SetFloat("_Blend", 0f);
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            }
            else
            {
                // Built-in Standard shader, "Fade" mode
                material.SetFloat("_Mode", 2f);
                material.EnableKeyword("_ALPHABLEND_ON");
                material.DisableKeyword("_ALPHATEST_ON");
                material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            }
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.renderQueue = (int)RenderQueue.Transparent;
        }

        private static int ColorKey(Color color)
        {
            Color32 c = color;
            return (c.r << 24) | (c.g << 16) | (c.b << 8) | c.a;
        }
    }
}
