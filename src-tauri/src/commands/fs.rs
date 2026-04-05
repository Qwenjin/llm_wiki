use std::fs;
use std::io::Read as IoRead;
use std::path::Path;

use crate::types::wiki::FileNode;

/// Known binary formats that need special extraction
const OFFICE_EXTS: &[&str] = &["docx", "pptx", "xlsx", "odt", "ods", "odp"];
const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "avif", "heic", "heif", "svg",
];
const MEDIA_EXTS: &[&str] = &[
    "mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v",
    "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma",
];
const LEGACY_DOC_EXTS: &[&str] = &["doc", "xls", "ppt", "pages", "numbers", "key", "epub"];

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Check cache first for any extractable format
    if let Some(cached) = read_cache(p) {
        return Ok(cached);
    }

    match ext.as_str() {
        "pdf" => extract_pdf_text(&path),
        e if OFFICE_EXTS.contains(&e) => extract_office_text(&path, e),
        e if IMAGE_EXTS.contains(&e) => {
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Ok(format!("[Image: {} ({:.1} KB)]", p.file_name().unwrap_or_default().to_string_lossy(), size as f64 / 1024.0))
        }
        e if MEDIA_EXTS.contains(&e) => {
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Ok(format!("[Media: {} ({:.1} MB)]", p.file_name().unwrap_or_default().to_string_lossy(), size as f64 / 1048576.0))
        }
        e if LEGACY_DOC_EXTS.contains(&e) => {
            Ok(format!("[Document: {} — text extraction not supported for .{} format]",
                p.file_name().unwrap_or_default().to_string_lossy(), e))
        }
        _ => {
            // Try reading as text; if it fails (binary), return a friendly message
            match fs::read_to_string(&path) {
                Ok(content) => Ok(content),
                Err(_) => {
                    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    Ok(format!("[Binary file: {} ({:.1} KB)]",
                        p.file_name().unwrap_or_default().to_string_lossy(), size as f64 / 1024.0))
                }
            }
        }
    }
}

/// Pre-process a file and cache the extracted text.
#[tauri::command]
pub fn preprocess_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let text = match ext.as_str() {
        "pdf" => extract_pdf_text(&path)?,
        e if OFFICE_EXTS.contains(&e) => extract_office_text(&path, e)?,
        _ => return Ok("no preprocessing needed".to_string()),
    };

    write_cache(p, &text)?;
    Ok(text)
}

fn cache_path_for(original: &Path) -> std::path::PathBuf {
    let parent = original.parent().unwrap_or(Path::new("."));
    let cache_dir = parent.join(".cache");
    let file_name = original
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    cache_dir.join(format!("{}.txt", file_name))
}

fn read_cache(original: &Path) -> Option<String> {
    let cache_path = cache_path_for(original);
    let original_modified = fs::metadata(original).ok()?.modified().ok()?;
    let cache_modified = fs::metadata(&cache_path).ok()?.modified().ok()?;
    if cache_modified >= original_modified {
        fs::read_to_string(&cache_path).ok()
    } else {
        None
    }
}

fn write_cache(original: &Path, text: &str) -> Result<(), String> {
    let cache_path = cache_path_for(original);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&cache_path, text)
        .map_err(|e| format!("Failed to write cache: {}", e))
}

fn extract_pdf_text(path: &str) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("Failed to read PDF '{}': {}", path, e))?;
    pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Failed to extract text from PDF '{}': {}", path, e))
}

/// Extract text from Office Open XML formats (docx, pptx, xlsx) and OpenDocument formats.
/// These are ZIP archives containing XML files with the actual content.
fn extract_office_text(path: &str, ext: &str) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive '{}': {}", path, e))?;

    let xml_paths: Vec<&str> = match ext {
        "docx" => vec!["word/document.xml"],
        "pptx" => {
            // PPTX has slide1.xml, slide2.xml, etc.
            let names: Vec<String> = (0..archive.len())
                .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
                .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
                .collect();
            return extract_xml_text_from_paths(&mut archive, &names);
        }
        "xlsx" => vec!["xl/sharedStrings.xml"],
        "odt" | "ods" | "odp" => vec!["content.xml"],
        _ => vec![],
    };

    extract_xml_text_from_paths(&mut archive, &xml_paths.iter().map(|s| s.to_string()).collect::<Vec<_>>())
}

fn extract_xml_text_from_paths(
    archive: &mut zip::ZipArchive<fs::File>,
    paths: &[String],
) -> Result<String, String> {
    let mut all_text = Vec::new();

    for xml_path in paths {
        let mut file = match archive.by_name(xml_path) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let mut xml_content = String::new();
        file.read_to_string(&mut xml_content)
            .map_err(|e| format!("Failed to read XML '{}': {}", xml_path, e))?;

        // Strip XML tags, keep text content
        let text = strip_xml_tags(&xml_content);
        let cleaned = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        if !cleaned.is_empty() {
            all_text.push(cleaned);
        }
    }

    if all_text.is_empty() {
        let fname = paths.first().map(|s| s.as_str()).unwrap_or("unknown");
        Ok(format!("[Could not extract text from this file (tried {})]", fname))
    } else {
        Ok(all_text.join("\n\n"))
    }
}

/// Simple XML tag stripper — removes all tags and decodes basic entities.
fn strip_xml_tags(xml: &str) -> String {
    let mut result = String::with_capacity(xml.len());
    let mut in_tag = false;

    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                // Add space after closing tags to separate words
                result.push(' ');
            }
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    // Decode common XML entities
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#10;", "\n")
        .replace("&#13;", "")
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs for '{}': {}", path, e))?;
    }
    fs::write(&path, contents).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: '{}'", path));
    }
    if !p.is_dir() {
        return Err(format!("Path is not a directory: '{}'", path));
    }
    let nodes = build_tree(p, 0, 3)?;
    Ok(nodes)
}

fn build_tree(dir: &Path, depth: usize, max_depth: usize) -> Result<Vec<FileNode>, String> {
    if depth >= max_depth {
        return Ok(vec![]);
    }

    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            // Skip dotfiles
            entry
                .file_name()
                .to_str()
                .map(|n| !n.starts_with('.'))
                .unwrap_or(false)
        })
        .collect();

    // Sort: directories first, then alphabetical within each group
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let mut nodes = Vec::new();
    for entry in entries {
        let entry_path = entry.path();
        let name = entry
            .file_name()
            .to_str()
            .unwrap_or("")
            .to_string();
        let path_str = entry_path.to_string_lossy().to_string();
        let is_dir = entry_path.is_dir();

        let children = if is_dir {
            let kids = build_tree(&entry_path, depth + 1, max_depth)?;
            if kids.is_empty() {
                None
            } else {
                Some(kids)
            }
        } else {
            None
        };

        nodes.push(FileNode {
            name,
            path: path_str,
            is_dir,
            children,
        });
    }

    Ok(nodes)
}

#[tauri::command]
pub fn copy_file(source: String, destination: String) -> Result<(), String> {
    let dest = Path::new(&destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    fs::copy(&source, &destination)
        .map_err(|e| format!("Failed to copy '{}' to '{}': {}", source, destination, e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
    } else {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete file '{}': {}", path, e))
    }
}

/// Find wiki pages that reference a given source file name.
/// Scans all .md files under wiki/ for the source filename in frontmatter or content.
#[tauri::command]
pub fn find_related_wiki_pages(project_path: String, source_name: String) -> Result<Vec<String>, String> {
    let wiki_dir = Path::new(&project_path).join("wiki");
    if !wiki_dir.is_dir() {
        return Ok(vec![]);
    }

    let mut related = Vec::new();
    collect_related_pages(&wiki_dir, &source_name, &mut related)?;
    Ok(related)
}

fn collect_related_pages(dir: &Path, source_name: &str, results: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    // derive a slug from source filename for matching (e.g., "my-article.pdf" → "my-article")
    let slug = source_name
        .rsplit('/')
        .next()
        .unwrap_or(source_name)
        .rsplit('.')
        .last()
        .unwrap_or(source_name)
        .to_lowercase();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_related_pages(&path, source_name, results)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            // Skip index.md and log.md — they'll be updated separately
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if fname == "index.md" || fname == "log.md" || fname == "overview.md" {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&path) {
                let content_lower = content.to_lowercase();
                // Match if the page references the source file name or its slug
                if content_lower.contains(&source_name.to_lowercase())
                    || content_lower.contains(&slug)
                {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}
