module Jekyll
  module BDAFilters
    def unique_authors(input)
      return input.map { | publication | publication["author"] }
        .flatten(1)
        .uniq
        .reject { |author| author.nil? }
        .map { | author | author[0] + "_" + author[1] }
    end

    def resources_by(input, person_id)
      if person_id.nil?
        return input
      else
        return input.select{ | resource | resource["people"].include?(person_id) }
      end
    end

    def is_publication_by(publication, person)
      if not publication["author"].nil?
        return publication["author"].select{ | author | (author[0] == person["name"][0] and author[1] == person["name"][1]) }.size > 0
      else
        return publication["editor"].select{ | editor | (editor[0] == person["name"][0] and editor[1] == person["name"][1]) }.size > 0
      end
    end

    def publications_by(input, person)
      if person.nil?
        return input
      else
        return input.select{ | publication | is_publication_by(publication, person) }
      end
    end
  end
end

Liquid::Template.register_filter(Jekyll::BDAFilters)
