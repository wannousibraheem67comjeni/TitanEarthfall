using UnityEngine;

namespace TitanEarthfall.Runner.View
{
    public enum SceneryStyle { Rocks, Ice, City, Dunes, Beach, Water, Forest, Farm, Desert, Cyber }

    /// <summary>Colors and decoration style for one biome.</summary>
    public struct BiomeTheme
    {
        public string Name;
        public SceneryStyle Style;
        public Color Sky;
        public Color Ground;
        public Color Side;
        public Color Rail;
        public Color Train;
        public Color TrainStripe;
        public Color PropA;
        public Color PropB;
        public Color Accent;
    }

    /// <summary>Visual themes in the same order as <see cref="BiomeManager.Biome"/>.</summary>
    public static class BiomePalette
    {
        private static readonly BiomeTheme[] Themes =
        {
            Theme("Mountain Heights", SceneryStyle.Rocks, "#8FB8E0", "#6B6158", "#5A7A4A", "#B0B0B0", "#C0392B", "#F1C40F", "#7D7468", "#4E6B3A", "#E67E22"),
            Theme("Alpine Snow Glaciers", SceneryStyle.Ice, "#CFE6F5", "#DCE8EF", "#F4FAFD", "#8AA1B1", "#2E86C1", "#ECF0F1", "#A9D3EA", "#FFFFFF", "#5DADE2"),
            Theme("Urban City", SceneryStyle.City, "#9DB4C8", "#4A4F55", "#5D6166", "#A6ACAF", "#E74C3C", "#F4D03F", "#7F8C8D", "#566573", "#F39C12"),
            Theme("Coastal Dunes", SceneryStyle.Dunes, "#A7D8F0", "#D9C08C", "#E8D3A0", "#8C7853", "#16A085", "#F7DC6F", "#E3C27D", "#C9A66B", "#1ABC9C"),
            Theme("Crowded Beach", SceneryStyle.Beach, "#7FD3F7", "#EBD9A8", "#F2E3B6", "#B38B59", "#E91E63", "#FFFFFF", "#FF7043", "#29B6F6", "#FFEB3B"),
            Theme("Abyssal Trench", SceneryStyle.Water, "#0B1E3A", "#123250", "#0A2440", "#2E5A7A", "#1F618D", "#48C9B0", "#145A7A", "#0E3B5C", "#48C9B0"),
            Theme("High Seas Tempest", SceneryStyle.Water, "#4A5A6A", "#2C4A5E", "#244052", "#7B8A8B", "#7B241C", "#F0B27A", "#34495E", "#2E4053", "#F5B041"),
            Theme("Rapid Rivers", SceneryStyle.Water, "#9CCFE8", "#3E7EA6", "#4F8F3E", "#8D6E63", "#6D4C41", "#FFCA28", "#5D8A3A", "#3E6B2F", "#26C6DA"),
            Theme("Calm Lake", SceneryStyle.Water, "#B8E2F2", "#5DA9C9", "#6FAF5F", "#A1887F", "#5C6BC0", "#FFF59D", "#7CB342", "#558B2F", "#4FC3F7"),
            Theme("Salt Flats", SceneryStyle.Desert, "#E3EEF5", "#EDEDE8", "#F5F5F0", "#9E9E9E", "#8E44AD", "#F5B7B1", "#E0E0DA", "#D5D5CC", "#AF7AC5"),
            Theme("Farmland Village", SceneryStyle.Farm, "#A9D6F5", "#8D6E4A", "#7CB342", "#A1887F", "#C62828", "#FFF176", "#C0A16B", "#8D3B2B", "#FFB300"),
            Theme("Deep Woodland", SceneryStyle.Forest, "#7E9F86", "#4E3B2A", "#2F5D2E", "#6D5845", "#33691E", "#D4E157", "#5D4037", "#1B5E20", "#9CCC65"),
            Theme("Scenic Wilderness", SceneryStyle.Forest, "#9ED0E6", "#6E5B45", "#5B8C3A", "#8D7B68", "#D35400", "#F9E79F", "#6E4B32", "#3D7A2A", "#F5B041"),
            Theme("Harsh Desert", SceneryStyle.Desert, "#F2D49B", "#C8924F", "#D9A35F", "#7A5230", "#A04000", "#FAD7A0", "#B9772F", "#4F7942", "#E59866"),
            Theme("Cyber Metropolis", SceneryStyle.Cyber, "#140B2E", "#1C1C2B", "#151525", "#00E5FF", "#6A1B9A", "#00E5FF", "#2A1B4A", "#FF00C8", "#00FFA3"),
            Theme("Homeland Village", SceneryStyle.Farm, "#B5DEF7", "#9C7A54", "#8BC34A", "#A1887F", "#1565C0", "#FFD54F", "#D7B98E", "#A1452F", "#FFCA28")
        };

        public static int Count => Themes.Length;

        public static BiomeTheme Get(int index) => Themes[((index % Themes.Length) + Themes.Length) % Themes.Length];

        private static BiomeTheme Theme(string name, SceneryStyle style, string sky, string ground, string side, string rail,
            string train, string trainStripe, string propA, string propB, string accent) => new BiomeTheme
        {
            Name = name,
            Style = style,
            Sky = Hex(sky),
            Ground = Hex(ground),
            Side = Hex(side),
            Rail = Hex(rail),
            Train = Hex(train),
            TrainStripe = Hex(trainStripe),
            PropA = Hex(propA),
            PropB = Hex(propB),
            Accent = Hex(accent)
        };

        private static Color Hex(string html) => ColorUtility.TryParseHtmlString(html, out var color) ? color : Color.magenta;
    }
}
