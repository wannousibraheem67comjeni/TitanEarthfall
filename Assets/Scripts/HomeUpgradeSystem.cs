using System;using UnityEngine;
/// <summary>Persistent village/home meta-progression system funded by Gems.</summary>
public sealed class HomeUpgradeSystem:MonoBehaviour
{
 public static HomeUpgradeSystem Instance{get;private set;}
 [Serializable]public sealed class UpgradeTier{public string displayName="Tier";[Min(0)]public int gemCost;[TextArea]public string description;}
 [Serializable]public sealed class UpgradeTrack{public string id;public UpgradeTier[] tiers;}
 [SerializeField]UpgradeTrack[] tracks;public event Action<string,int> UpgradeCompleted;const string Prefix="home.upgrade.";
 private void Awake(){if(Instance&&Instance!=this){Destroy(gameObject);return;}Instance=this;DontDestroyOnLoad(gameObject);}
 /// <summary>Gets the purchased tier count for a track.</summary>public int GetTier(string id)=>PlayerPrefs.GetInt(Prefix+id,0);
 /// <summary>Purchases the next tier if Gems are available.</summary>public bool TryUpgrade(string id){UpgradeTrack t=Find(id);if(t==null||t.tiers==null)return false;int current=GetTier(id);if(current>=t.tiers.Length)return false;if(!EconomyManager.Instance||!EconomyManager.Instance.TrySpendGems(t.tiers[current].gemCost))return false;int next=current+1;PlayerPrefs.SetInt(Prefix+id,next);PlayerPrefs.Save();UpgradeCompleted?.Invoke(id,next);return true;}
 /// <summary>Clears all configured upgrade progress; intended for profile-reset tooling.</summary>public void ResetProgress(){if(tracks==null)return;foreach(var t in tracks)if(t!=null&&!string.IsNullOrEmpty(t.id))PlayerPrefs.DeleteKey(Prefix+t.id);PlayerPrefs.Save();}
 private UpgradeTrack Find(string id){if(tracks==null)return null;foreach(var t in tracks)if(t!=null&&string.Equals(t.id,id,StringComparison.Ordinal))return t;return null;}
}